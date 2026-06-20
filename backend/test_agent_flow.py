import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import BackgroundTasks

from backend import jimeng_cli
from backend import main


class FakeStoryboardResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": self.content,
                    }
                }
            ]
        }


class FakeStoryboardClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.posts = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        self.posts.append((args, kwargs))
        return FakeStoryboardResponse(self.responses.pop(0))


class AgentFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.agent_runs.clear()
        main.shots_db.clear()
        main.task_queue = asyncio.Queue()

    async def test_mock_agent_flow_returns_video_result(self):
        run = main.AgentRun(
            id="agent-test",
            userId="user-test",
            userEmail="test@example.com",
            idea="一位设计师在清晨城市中寻找灵感",
            duration=30,
            style="电影感",
            ratio="16:9",
            createdAt=main.time.time(),
            updatedAt=main.time.time(),
        )
        main.agent_runs[run.id] = run
        mock_settings = main.AgentSettings(jimengMode="mock")

        with patch.object(main, "load_agent_settings", return_value=mock_settings):
            await main.process_agent_run(run.id)

        planned_run = main.agent_runs[run.id]
        self.assertEqual(planned_run.status, "awaiting_confirmation")
        self.assertEqual(planned_run.stage, "awaiting_confirmation")
        self.assertEqual(planned_run.agentModel, "local-storyboard")
        self.assertEqual(len(planned_run.candidates), 1)
        self.assertEqual(len(planned_run.candidates[0].scenes), 3)

        with (
            patch.object(main, "load_agent_settings", return_value=mock_settings),
            patch.object(main, "MOCK_GENERATION_STEP_SECONDS", 0.001),
            patch.object(main, "MOCK_GENERATION_ERROR_RATE", 0),
        ):
            background_tasks = BackgroundTasks()
            current_user = main.UserRecord(
                id=run.userId,
                name="测试用户",
                email=run.userEmail,
                passwordHash="not-used",
                createdAt=main.time.time(),
            )
            selected_candidate = planned_run.candidates[0]
            await main.confirm_agent_run(
                run.id,
                main.AgentConfirmPayload(
                    candidateId=selected_candidate.id,
                    scenes=[
                        main.AgentSceneEdit(
                            title=scene.title,
                            prompt=f"{scene.prompt} 追加一处可编辑后的细节。",
                            duration=scene.duration,
                        )
                        for scene in selected_candidate.scenes
                    ],
                ),
                background_tasks,
                current_user,
            )
            await main.process_confirmed_run(run.id)

        completed_run = main.sync_run_from_shots(main.agent_runs[run.id])
        self.assertEqual(completed_run.status, "completed")
        self.assertEqual(completed_run.stage, "completed")
        self.assertEqual(completed_run.progress, 100)
        self.assertTrue(completed_run.finalVideoUrl)
        self.assertTrue(all(scene.status == "completed" for scene in completed_run.scenes))

    async def test_storyboard_malformed_json_is_repaired(self):
        payload = main.AgentCreatePayload(
            idea="角色说你好，然后走向窗边。",
            duration=15,
            segmentDuration=5,
            style="电影感",
            ratio="16:9",
        )
        settings = main.AgentSettings(
            deepseekApiKey="test-key",
            deepseekModel="deepseek-v4-flash",
        )
        broken_json = (
            '{"title":"测试候选","summary":"包含未转义对话",'
            '"scenes":[{"title":"第一段","prompt":"角色说："你好"，然后走向窗边。"},'
            '{"title":"第二段","prompt":"角色停在窗边，镜头缓慢推进。"},'
            '{"title":"第三段","prompt":"角色回头望向远处的城市光。"}]}'
        )
        repaired_json = json.dumps(
            {
                "title": "测试候选",
                "summary": "包含修复后的对话",
                "scenes": [
                    {"title": "第一段", "prompt": "角色说「你好」，然后走向窗边。"},
                    {"title": "第二段", "prompt": "角色停在窗边，镜头缓慢推进。"},
                    {"title": "第三段", "prompt": "角色回头望向远处的城市光。"},
                ],
            },
            ensure_ascii=False,
        )
        fake_client = FakeStoryboardClient([broken_json, repaired_json])

        with patch.object(main.httpx, "AsyncClient", return_value=fake_client):
            candidate = await main.plan_storyboard_candidate(payload, "agent-json", settings)

        self.assertEqual(len(fake_client.posts), 2)
        self.assertEqual(candidate.title, "测试候选")
        self.assertEqual(len(candidate.scenes), 3)
        self.assertIn("「你好」", candidate.scenes[0].prompt)

    def test_load_users_accepts_utf8_bom(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            users_file = data_dir / "users.json"
            user = main.UserRecord(
                id="user-bom",
                name="编码测试",
                email="bom@example.com",
                passwordHash="not-used",
                createdAt=main.time.time(),
            )
            users_file.write_text(
                json.dumps({user.email: user.model_dump()}, ensure_ascii=False),
                encoding="utf-8-sig",
            )

            with (
                patch.object(main, "DATA_DIR", data_dir),
                patch.object(main, "USERS_FILE", users_file),
            ):
                loaded_users = main.load_users()

            self.assertEqual(loaded_users[user.email].name, user.name)

    def test_cli_parser_preserves_top_level_arrays(self):
        output = """
Dreamina CLI
[
  {"submit_id": "first", "gen_status": "success"},
  {"submit_id": "second", "gen_status": "fail"}
]
"""

        parsed = jimeng_cli.parse_json_value(output)

        self.assertIsInstance(parsed, list)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[1]["submit_id"], "second")


if __name__ == "__main__":
    unittest.main()
