import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


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
        self.assertEqual(planned_run.status, "generating")
        self.assertEqual(planned_run.agentModel, "local-storyboard")
        self.assertEqual(len(planned_run.scenes), 2)

        shot_ids = []
        while not main.task_queue.empty():
            shot_ids.append(await main.task_queue.get())

        with (
            patch.object(main, "MOCK_GENERATION_STEP_SECONDS", 0.001),
            patch.object(main, "MOCK_GENERATION_ERROR_RATE", 0),
        ):
            await asyncio.gather(
                *(main.simulate_video_generation(shot_id, None) for shot_id in shot_ids)
            )

        completed_run = main.sync_run_from_shots(planned_run)
        self.assertEqual(completed_run.status, "completed")
        self.assertEqual(completed_run.stage, "completed")
        self.assertEqual(completed_run.progress, 100)
        self.assertTrue(completed_run.finalVideoUrl)
        self.assertTrue(all(scene.status == "completed" for scene in completed_run.scenes))

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


if __name__ == "__main__":
    unittest.main()
