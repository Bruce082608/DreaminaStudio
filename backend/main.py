import asyncio
import logging
import random
import time
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dreamina_backend")

app = FastAPI(
    title="Dreamina Studio Backend",
    description="Queue-based backend for Dreamina Studio with cookie pool routing and video generation.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# Models & Schemas
# ==========================================

class Cookie(BaseModel):
    id: str
    alias: str
    value: str
    status: str = "active"  # active, expired, rate_limited
    activeTasks: int = Field(default=0, alias="activeTasks")
    failCount: int = Field(default=0, alias="failCount")

    class Config:
        populate_by_name = True

class Character(BaseModel):
    id: str
    name: str
    basePrompt: str
    avatar: Optional[str] = None
    gender: str

class Shot(BaseModel):
    id: str
    characterIds: List[str] = []
    prompt: str
    duration: int = 8
    engine: str = "jimeng"
    status: str = "idle"  # idle, waiting, generating, completed, failed
    progress: int = 0
    videoUrl: Optional[str] = None
    caption: Optional[str] = None
    error: Optional[str] = None

class CompileParams(BaseModel):
    bgm: str = "lofi"
    bgmVolume: int = 30
    voiceVolume: int = 80
    totalDuration: int = 60
    shotIds: List[str]

# ==========================================
# In-Memory Database / State
# ==========================================

cookie_pool: Dict[str, Cookie] = {
    "cookie-1": Cookie(
        id="cookie-1",
        alias="主账号_VIP (即梦)",
        value="sessionid_ss=vip_cookie_hash_01_a9f3b...",
        status="active",
        activeTasks=0,
        failCount=0
    ),
    "cookie-2": Cookie(
        id="cookie-2",
        alias="备用号_01 (即梦)",
        value="sessionid_ss=free_cookie_hash_02_bc482...",
        status="active",
        activeTasks=0,
        failCount=0
    )
}

shots_db: Dict[str, Shot] = {}
task_queue: asyncio.Queue = asyncio.Queue()
active_workers = []

# Mock Video URLs
MOCK_VIDEOS = [
    "https://assets.mixkit.co/videos/preview/mixkit-barista-pouring-milk-into-a-cup-of-coffee-41617-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-pouring-hot-water-into-a-chemex-41712-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-steaming-cup-of-coffee-close-up-41713-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-freshly-brewed-coffee-dripping-into-a-pot-41714-large.mp4"
]

# ==========================================
# Background Generation Worker
# ==========================================

async def simulate_video_generation(shot_id: str, cookie_id: Optional[str]):
    """
    Simulates the background video generation process, calling Douyin Jimeng API.
    Increments progress and marks success/failure depending on configuration.
    """
    try:
        shot = shots_db.get(shot_id)
        if not shot:
            return

        shot.status = "generating"
        shot.progress = 0
        shot.error = None
        
        total_steps = 10
        delay_per_step = 1.0  # seconds

        # Simulate rendering progress
        for i in range(1, total_steps + 1):
            await asyncio.sleep(delay_per_step)
            shot.progress = int((i / total_steps) * 100)
            logger.info(f"Shot {shot_id} progress: {shot.progress}%")

        # Determine success/failure based on mock error rates
        error_rate = 0.05 if shot.engine == "jimeng" else (0.10 if shot.engine == "kling" else 0.20)
        is_success = random.random() > error_rate

        if is_success:
            shot.status = "completed"
            shot.videoUrl = random.choice(MOCK_VIDEOS)
            shot.caption = shot.prompt.split(",")[-1].strip() if shot.prompt else "时光咖啡馆..."
            logger.info(f"Shot {shot_id} generated successfully. URL: {shot.videoUrl}")
            
            # Reset cookie fail count on success
            if cookie_id and cookie_id in cookie_pool:
                cookie_pool[cookie_id].failCount = 0
        else:
            shot.status = "failed"
            shot.progress = 0
            
            # Simulated error messages
            errors = {
                "jimeng": "即梦API并发超限，请稍后重试 (Concurrency Limit Exceeded)",
                "kling": "可灵上游服务器排队溢出，请求被自动熔断 (Queue Overflow)",
                "hunyuan": "CUDA Out of Memory: GPU VRAM Allocation Error"
            }
            shot.error = errors.get(shot.engine, "未知的网关上游响应异常")
            logger.error(f"Shot {shot_id} failed: {shot.error}")

            # Update cookie fail count
            if cookie_id and cookie_id in cookie_pool:
                c = cookie_pool[cookie_id]
                c.failCount += 1
                if c.failCount >= 3:
                    c.status = "expired"
                    logger.warning(f"Cookie [{c.alias}] has failed 3 times and is now marked EXPIRED.")

    except Exception as e:
        logger.error(f"Unexpected error in background generation: {e}")
        if shot_id in shots_db:
            shots_db[shot_id].status = "failed"
            shots_db[shot_id].error = str(e)
    finally:
        # Release the active task counter from the cookie
        if cookie_id and cookie_id in cookie_pool:
            cookie_pool[cookie_id].activeTasks = max(0, cookie_pool[cookie_id].activeTasks - 1)

async def queue_worker():
    """
    Asynchronous queue worker that continuously pulls tasks and routes them
    using healthy cookies from the cookie pool.
    """
    logger.info("Background queue worker started.")
    while True:
        try:
            shot_id = await task_queue.get()
            logger.info(f"Pulled shot {shot_id} from queue.")

            shot = shots_db.get(shot_id)
            if not shot:
                task_queue.task_done()
                continue

            # Assign cookie if engine is Jimeng
            assigned_cookie_id = None
            if shot.engine == "jimeng":
                while True:
                    active_cookies = [c for c in cookie_pool.values() if c.status == "active"]
                    available_cookies = [c for c in active_cookies if c.activeTasks < 2]

                    if available_cookies:
                        break

                    if not active_cookies:
                        shot.status = "failed"
                        shot.error = "逆向网关异常：即梦 Cookie 账号池无可用节点 (账号已失效)"
                        logger.warning(f"Failed to schedule shot {shot_id}: No healthy cookies available.")
                        task_queue.task_done()
                        break

                    logger.info(f"All Jimeng cookies are busy. Waiting to schedule shot {shot_id}.")
                    await asyncio.sleep(1)

                if shot.status == "failed":
                    continue
                
                # Pick the cookie with lowest current active load
                chosen_cookie = min(available_cookies, key=lambda c: c.activeTasks)
                chosen_cookie.activeTasks += 1
                assigned_cookie_id = chosen_cookie.id
                logger.info(f"Assigned Cookie [{chosen_cookie.alias}] to Shot {shot_id}")

            # Start video generation as a non-blocking background asyncio task
            asyncio.create_task(simulate_video_generation(shot_id, assigned_cookie_id))
            task_queue.task_done()
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in queue worker: {e}")
            await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    # Start background task queue worker
    worker_task = asyncio.create_task(queue_worker())
    active_workers.append(worker_task)

@app.on_event("shutdown")
async def shutdown_event():
    for w in active_workers:
        w.cancel()
    await asyncio.gather(*active_workers, return_exceptions=True)

# ==========================================
# REST API Routes
# ==========================================

@app.get("/health")
def health_check():
    """Return hardware status and backend health information."""
    return {
        "status": "healthy",
        "cpu_usage_pct": round(random.uniform(5.0, 15.0), 1),
        "vram_allocated_gb": 0.0,
        "concurrency_limit": 2,
        "queue_size": task_queue.qsize(),
        "timestamp": time.time()
    }

# --- Cookie Pool CRUD ---

@app.get("/cookies", response_model=List[Cookie])
def get_all_cookies():
    return list(cookie_pool.values())

@app.post("/cookies", response_model=Cookie)
def add_cookie(cookie: Cookie):
    if cookie.id in cookie_pool:
        raise HTTPException(status_code=400, detail="Cookie ID already exists")
    cookie_pool[cookie.id] = cookie
    return cookie

@app.put("/cookies/{cookie_id}", response_model=Cookie)
def update_cookie(cookie_id: str, updates: Cookie):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    cookie_pool[cookie_id] = updates
    return updates

@app.delete("/cookies/{cookie_id}")
def delete_cookie(cookie_id: str):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    del cookie_pool[cookie_id]
    return {"message": f"Cookie {cookie_id} successfully deleted"}

@app.post("/cookies/{cookie_id}/validate")
async def validate_cookie(cookie_id: str):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    
    # Simulate validation latency
    await asyncio.sleep(1.0)
    c = cookie_pool[cookie_id]
    c.status = "active"
    c.failCount = 0
    return {"status": "success", "message": f"Cookie {c.alias} verified successfully."}

# --- Storyboard & Task Dispatch ---

@app.get("/shots", response_model=List[Shot])
def get_all_shots():
    return list(shots_db.values())

@app.post("/shots", response_model=Shot)
def upsert_shot(shot: Shot):
    shots_db[shot.id] = shot
    return shot

@app.post("/generate/{shot_id}")
async def queue_generation(shot_id: str, shot_payload: Optional[Shot] = None):
    """Adds a shot to the asynchronous video generation queue."""
    if shot_payload:
        shots_db[shot_id] = shot_payload
    elif shot_id not in shots_db:
        raise HTTPException(status_code=404, detail="Shot not found in database")

    shot = shots_db[shot_id]
    shot.status = "waiting"
    shot.progress = 0
    shot.error = None
    
    await task_queue.put(shot_id)
    return {"status": "queued", "shot_id": shot_id, "queue_position": task_queue.qsize()}

@app.post("/compile")
async def compile_final_video(params: CompileParams):
    """
    Mock endpoint representing the final ffmpeg mixing process.
    Mixes BGM audio, voice-overs, and stacks the completed video clips.
    """
    logger.info(f"Starting compile task for shots {params.shotIds}")
    
    # Verify all referenced shots exist and are completed
    completed_videos = []
    for s_id in params.shotIds:
        shot = shots_db.get(s_id)
        if shot and shot.status == "completed" and shot.videoUrl:
            completed_videos.append(shot.videoUrl)
            
    if not completed_videos:
        raise HTTPException(
            status_code=400, 
            detail="Must have at least one successfully generated shot to compile."
        )

    # Return the first clip as the compiled result, simulating a successful edit
    result_url = completed_videos[0]
    
    return {
        "status": "success",
        "video_url": result_url,
        "bgm": params.bgm,
        "total_duration": params.totalDuration,
        "message": f"Compilation successful with BGM: {params.bgm}"
    }
