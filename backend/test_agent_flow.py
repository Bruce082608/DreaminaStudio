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


class FakeSmtpClient:
    captured = {}

    def __init__(self, host, port, timeout):
        self.captured["host"] = host
        self.captured["port"] = port
        self.captured["timeout"] = timeout
        self.captured["started_tls"] = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def starttls(self):
        self.captured["started_tls"] = True

    def login(self, username, password):
        self.captured["username"] = username
        self.captured["password"] = password

    def send_message(self, message):
        self.captured["subject"] = message["Subject"]
        self.captured["from"] = message["From"]
        self.captured["to"] = message["To"]
        self.captured["body"] = message.get_content()


class AgentFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database_dir = tempfile.TemporaryDirectory()
        self.database_patcher = patch.object(
            main.database,
            "DATABASE_URL",
            f"sqlite:///{Path(self.database_dir.name) / 'test.sqlite3'}",
        )
        self.database_patcher.start()
        main.database.init_database()
        main.agent_runs.clear()
        main.shots_db.clear()
        main.task_queue = asyncio.Queue()

    async def asyncTearDown(self):
        self.database_patcher.stop()
        self.database_dir.cleanup()

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
            patch.object(main, "charge_user_credits"),
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
        self.assertEqual(completed_run.creditCost, 60)
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

    def test_json_user_migration_accepts_utf8_bom(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            users_file = data_dir / "users.json"
            transactions_file = data_dir / "credit_transactions.json"
            codes_file = data_dir / "verification_codes.json"
            database_file = data_dir / "migrated.sqlite3"
            user = main.UserRecord(
                id="user-bom",
                name="编码测试",
                email="bom@example.com",
                passwordHash="not-used",
                createdAt=main.time.time(),
            )
            users_file.write_text(
                json.dumps({user.email: main.dump_model(user)}, ensure_ascii=False),
                encoding="utf-8-sig",
            )

            with (
                patch.object(main, "DATA_DIR", data_dir),
                patch.object(main, "USERS_FILE", users_file),
                patch.object(main, "TRANSACTIONS_FILE", transactions_file),
                patch.object(main, "VERIFICATION_CODES_FILE", codes_file),
                patch.object(main.database, "DATABASE_URL", f"sqlite:///{database_file}"),
            ):
                main.database.migrate_json_files(users_file, transactions_file, codes_file)
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

    def test_recharge_and_generation_charge_update_balance(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            users_file = data_dir / "users.json"
            transactions_file = data_dir / "credit_transactions.json"
            user = main.UserRecord(
                id="user-credit",
                name="积分用户",
                email="credit@example.com",
                passwordHash="not-used",
                creditBalance=15,
                createdAt=main.time.time(),
            )

            with (
                patch.object(main, "DATA_DIR", data_dir),
                patch.object(main, "USERS_FILE", users_file),
                patch.object(main, "TRANSACTIONS_FILE", transactions_file),
            ):
                main.save_users({user.email: user})

                recharge = main.recharge_user_credits(user.email, "first_trial_50")
                recharged_user = main.load_users()[user.email]
                self.assertEqual(recharge.amount, 50)
                self.assertEqual(recharged_user.creditBalance, 65)
                self.assertTrue(main.user_has_recharged(recharged_user))

                cost = main.calculate_video_credit_cost("seedance2.0fast", [15, 15])
                debit = main.charge_user_credits(user.email, cost, "测试扣费", run_id="agent-credit")
                charged_user = main.load_users()[user.email]

                self.assertEqual(cost, 60)
                self.assertEqual(debit.amount, -60)
                self.assertEqual(charged_user.creditBalance, 5)
                self.assertEqual(len(main.load_credit_transactions()), 2)

    def test_recharge_request_requires_admin_approval(self):
        user = main.UserRecord(
            id="user-payment",
            name="付款用户",
            email="payment@example.com",
            passwordHash="not-used",
            creditBalance=15,
            createdAt=main.time.time(),
        )
        admin = main.UserRecord(
            id="user-admin",
            name="管理员",
            email="admin@example.com",
            passwordHash="not-used",
            role="admin",
            creditBalance=15,
            createdAt=main.time.time(),
        )
        main.save_users({user.email: user, admin.email: admin})

        recharge_request = main.create_user_recharge_request(user, "starter_100")
        unchanged_user = main.load_users()[user.email]

        self.assertEqual(recharge_request.status, "pending")
        self.assertEqual(recharge_request.credits, 100)
        self.assertEqual(unchanged_user.creditBalance, 15)
        self.assertEqual(len(main.load_admin_recharge_requests(status="pending")), 1)

        with self.assertRaises(main.HTTPException):
            main.approve_admin_recharge_request(
                recharge_request.id,
                main.RechargeApprovalPayload(),
                admin,
            )

        approval = main.approve_admin_recharge_request(
            recharge_request.id,
            main.RechargeApprovalPayload(credits=100),
            admin,
        )
        approved_request = approval["request"]
        transaction = approval["transaction"]
        approved_user = main.load_users()[user.email]

        self.assertEqual(approved_request.status, "approved")
        self.assertEqual(transaction.amount, 100)
        self.assertEqual(approved_user.creditBalance, 115)
        self.assertEqual(approved_user.rechargeCount, 1)
        self.assertEqual(len(main.load_credit_transactions()), 1)

        cancel_request = main.create_user_recharge_request(approved_user, "creator_500")
        canceled_request = main.cancel_my_recharge_request(cancel_request.id, approved_user)
        self.assertEqual(canceled_request.status, "canceled")
        self.assertEqual(main.load_users()[user.email].creditBalance, 115)

    def test_email_registration_login_and_profile_updates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            users_file = data_dir / "users.json"
            transactions_file = data_dir / "credit_transactions.json"
            codes_file = data_dir / "verification_codes.json"

            with (
                patch.object(main, "DATA_DIR", data_dir),
                patch.object(main, "USERS_FILE", users_file),
                patch.object(main, "TRANSACTIONS_FILE", transactions_file),
                patch.object(main, "VERIFICATION_CODES_FILE", codes_file),
                patch.object(main, "VERIFICATION_CODE_DEV_MODE", True),
                patch.object(main, "SMTP_HOST", None),
            ):
                code_response = main.request_verification_code(main.VerificationCodePayload(
                    channel="email",
                    identifier="new-user@example.com",
                ))
                registered = main.register_user(main.RegisterPayload(
                    name="新用户",
                    channel="email",
                    identifier="new-user@example.com",
                    code=code_response.devCode,
                    password="Secret123",
                ))

                self.assertEqual(registered.user.email, "new-user@example.com")
                self.assertEqual(registered.user.creditBalance, 15)
                self.assertIn("new-user@example.com", main.load_users())

                logged_in = main.login_user(main.AuthPayload(
                    identifier="new-user@example.com",
                    password="Secret123",
                ))
                self.assertEqual(logged_in.user.loginCount, 2)

                updated_user = main.update_profile(
                    main.ProfileUpdatePayload(name="新用户名"),
                    current_user=main.load_users()["new-user@example.com"],
                )
                self.assertEqual(updated_user.name, "新用户名")

                main.change_password(
                    main.PasswordChangePayload(
                        currentPassword="Secret123",
                        newPassword="NewSecret123",
                    ),
                    current_user=main.load_users()["new-user@example.com"],
                )

                with self.assertRaises(main.HTTPException) as old_password_error:
                    main.login_user(main.AuthPayload(
                        identifier="new-user@example.com",
                        password="Secret123",
                    ))
                self.assertEqual(old_password_error.exception.status_code, 401)

                next_login = main.login_user(main.AuthPayload(
                    identifier="new-user@example.com",
                    password="NewSecret123",
                ))
                self.assertEqual(next_login.user.name, "新用户名")

    def test_email_sender_uses_configured_smtp_ssl(self):
        FakeSmtpClient.captured = {}

        with (
            patch.object(main, "VERIFICATION_CODE_DEV_MODE", False),
            patch.object(main, "SMTP_HOST", "smtp.qq.com"),
            patch.object(main, "SMTP_PORT", 465),
            patch.object(main, "SMTP_USERNAME", "873831183@qq.com"),
            patch.object(main, "SMTP_PASSWORD", "qq-mail-auth-code"),
            patch.object(main, "SMTP_FROM", "873831183@qq.com"),
            patch.object(main, "SMTP_USE_SSL", True),
            patch.object(main, "SMTP_USE_TLS", False),
            patch.object(main.smtplib, "SMTP_SSL", FakeSmtpClient),
        ):
            delivery = main.send_email_code("new-user@example.com", "123456")

        self.assertEqual(delivery, "email")
        self.assertEqual(FakeSmtpClient.captured["host"], "smtp.qq.com")
        self.assertEqual(FakeSmtpClient.captured["port"], 465)
        self.assertEqual(FakeSmtpClient.captured["username"], "873831183@qq.com")
        self.assertEqual(FakeSmtpClient.captured["password"], "qq-mail-auth-code")
        self.assertEqual(FakeSmtpClient.captured["to"], "new-user@example.com")
        self.assertIn("123456", FakeSmtpClient.captured["body"])
        self.assertFalse(FakeSmtpClient.captured["started_tls"])

    def test_phone_like_registration_identifier_is_rejected(self):
        with self.assertRaises(main.HTTPException) as request_error:
            main.request_verification_code(main.VerificationCodePayload(
                identifier="15500000001",
            ))

        self.assertEqual(request_error.exception.status_code, 400)
        self.assertEqual(main.load_verification_codes(), {})

    def test_request_code_does_not_persist_when_delivery_fails(self):
        with patch.object(
            main,
            "send_email_code",
            side_effect=main.HTTPException(status_code=502, detail="发送失败"),
        ):
            with self.assertRaises(main.HTTPException):
                main.request_verification_code(main.VerificationCodePayload(
                    channel="email",
                    identifier="fail@example.com",
                ))

        self.assertEqual(main.load_verification_codes(), {})


if __name__ == "__main__":
    unittest.main()
