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
        self.storage_dir = tempfile.TemporaryDirectory()
        storage_path = Path(self.storage_dir.name)
        self.database_patcher = patch.object(
            main.database,
            "DATABASE_URL",
            f"sqlite:///{Path(self.database_dir.name) / 'test.sqlite3'}",
        )
        self.database_patcher.start()
        self.agent_runs_file_patcher = patch.object(main, "AGENT_RUNS_FILE", storage_path / "agent_runs.json")
        self.uploaded_references_file_patcher = patch.object(
            main,
            "UPLOADED_REFERENCES_FILE",
            storage_path / "uploaded_references.json",
        )
        self.uploads_dir_patcher = patch.object(main, "UPLOADS_DIR", storage_path / "uploads")
        self.agent_runs_file_patcher.start()
        self.uploaded_references_file_patcher.start()
        self.uploads_dir_patcher.start()
        main.database.init_database()
        main.agent_runs.clear()
        main.shots_db.clear()
        main.uploaded_references.clear()
        main.task_queue = asyncio.Queue()

    async def asyncTearDown(self):
        self.uploads_dir_patcher.stop()
        self.uploaded_references_file_patcher.stop()
        self.agent_runs_file_patcher.stop()
        self.database_patcher.stop()
        self.storage_dir.cleanup()
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

    async def test_agent_run_history_survives_memory_reset(self):
        run = main.AgentRun(
            id="agent-persisted",
            userId="user-owner",
            userEmail="owner@example.com",
            idea="一条需要长时间生成的影片",
            duration=30,
            segmentDuration=10,
            style="电影感",
            ratio="16:9",
            status="generating",
            stage="jimeng_generating",
            progress=45,
            creditCost=60,
            createdAt=main.time.time(),
            updatedAt=main.time.time(),
            scenes=[
                main.AgentRunScene(
                    id="agent-persisted-scene-1",
                    number="01",
                    time="00:00 - 00:10",
                    title="第一段",
                    prompt="角色在城市街头奔跑，镜头低角度跟随。",
                    duration=10,
                    status="generating",
                    progress=45,
                )
            ],
        )
        main.persist_agent_run(run)

        main.agent_runs.clear()
        main.load_agent_runs_from_disk()

        owner = main.UserRecord(
            id="user-owner",
            name="Owner",
            email="owner@example.com",
            passwordHash="not-used",
            createdAt=main.time.time(),
        )
        other = main.UserRecord(
            id="user-other",
            name="Other",
            email="other@example.com",
            passwordHash="not-used",
            createdAt=main.time.time(),
        )

        self.assertIn(run.id, main.agent_runs)
        owner_runs = main.list_agent_runs(20, owner)
        self.assertEqual([item.id for item in owner_runs], [run.id])
        self.assertEqual(main.list_agent_runs(20, other), [])

    async def test_uploaded_reference_index_survives_memory_reset(self):
        reference_path = Path(self.storage_dir.name) / "uploads" / "user-ref" / "ref-1.png"
        reference_path.parent.mkdir(parents=True, exist_ok=True)
        reference_path.write_bytes(b"fake-image")
        reference = main.UploadedReference(
            id="ref-1",
            userId="user-ref",
            name="人物.png",
            path=str(reference_path),
        )
        main.uploaded_references[reference.id] = reference
        main.persist_uploaded_references()

        main.uploaded_references.clear()
        main.load_uploaded_references_from_disk()

        self.assertIn(reference.id, main.uploaded_references)
        self.assertEqual(main.uploaded_references[reference.id].name, "人物.png")

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

    def test_scene_prompt_uses_referenced_image_subset(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            reference_dir = Path(temp_dir)
            image_one = reference_dir / "one.png"
            image_two = reference_dir / "two.png"
            image_one.write_bytes(b"fake-one")
            image_two.write_bytes(b"fake-two")
            main.uploaded_references.clear()
            main.uploaded_references.update(
                {
                    "ref-1": main.UploadedReference(
                        id="ref-1",
                        userId="user-ref",
                        name="人物.png",
                        path=str(image_one),
                    ),
                    "ref-2": main.UploadedReference(
                        id="ref-2",
                        userId="user-ref",
                        name="产品.png",
                        path=str(image_two),
                    ),
                }
            )
            run = main.AgentRun(
                id="agent-ref",
                userId="user-ref",
                userEmail="ref@example.com",
                idea="让 @图片2 出现在桌面上",
                duration=15,
                segmentDuration=15,
                style="电影感",
                ratio="16:9",
                imageNames=["人物.png", "产品.png"],
                imageIds=["ref-1", "ref-2"],
                imageReferences=[
                    main.AgentImageReference(id="ref-1", name="人物.png", label="图片1", token="@图片1"),
                    main.AgentImageReference(id="ref-2", name="产品.png", label="图片2", token="@图片2"),
                ],
                createdAt=main.time.time(),
                updatedAt=main.time.time(),
            )
            scene = main.AgentRunScene(
                id="scene-ref",
                number="01",
                time="0:00 - 0:15",
                title="产品展示",
                prompt="特写 @图片2 放在木桌中央，柔和光线。",
                duration=15,
            )

            prompt, paths = main.prepare_scene_prompt_and_references(run, scene)

            self.assertEqual(paths, [image_two])
            self.assertIn("@image_file_1=图片2", prompt)
            self.assertIn("@image_file_1 放在木桌中央", prompt)
            self.assertNotIn("@图片2", prompt)

    def test_storyboard_prompt_includes_scene_and_sound_constraints(self):
        payload = main.AgentCreatePayload(
            idea="角色在室内完成产品展示。",
            duration=15,
            segmentDuration=15,
            style="跟随参考图",
            ratio="21:9",
            sceneLimit="所有镜头都发生在白色极简展厅。",
            blockSubtitles=True,
            soundEffectOnly=True,
            forceMute=False,
        )

        prompt = main.build_storyboard_prompt(payload)

        self.assertIn("所有镜头都发生在白色极简展厅", prompt)
        self.assertIn("不要出现任何字幕", prompt)
        self.assertIn("不要有任何背景音乐，只保留音效", prompt)
        self.assertIn("21:9", prompt)

    def test_failed_scene_refund_is_recorded_once(self):
        user = main.UserRecord(
            id="user-refund",
            name="退款用户",
            email="refund@example.com",
            passwordHash="not-used",
            creditBalance=0,
            createdAt=main.time.time(),
        )
        main.save_users({user.email: user})
        run = main.AgentRun(
            id="agent-refund",
            userId=user.id,
            userEmail=user.email,
            idea="测试失败退款",
            duration=15,
            segmentDuration=15,
            style="电影感",
            ratio="16:9",
            jimengModel="seedance2.0fast",
            createdAt=main.time.time(),
            updatedAt=main.time.time(),
        )
        scene = main.AgentRunScene(
            id="scene-refund",
            number="01",
            time="0:00 - 0:15",
            title="失败片段",
            prompt="测试提示词",
            duration=15,
        )
        run.scenes = [scene]

        main.refund_failed_scene_if_needed(run, scene)
        main.refund_failed_scene_if_needed(run, scene)
        refunded_user = main.load_users()[user.email]
        transactions = main.load_credit_transactions()

        self.assertEqual(refunded_user.creditBalance, 30)
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].type, "refund")
        self.assertEqual(run.scenes[0].refundCredit, 30)
        self.assertIsNotNone(run.scenes[0].creditRefundedAt)

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

    def test_jimeng_failure_reason_is_human_readable(self):
        failure = jimeng_cli.describe_generation_failure({
            "submit_id": "ea77a2f5-b078-486a-afcb-a471cddbc450",
            "prompt": "强制限制：不要出现任何字幕。这里是一段很长的分镜提示词。",
            "logid": "202606211643151720180000022650281",
            "gen_status": "fail",
            "fail_reason": "api",
        })
        message = jimeng_cli.format_generation_failure(failure)

        self.assertEqual(failure.category, "platform")
        self.assertEqual(failure.reason, "api")
        self.assertIn("即梦平台接口异常", message)
        self.assertIn("原因码：api", message)
        self.assertIn("提交ID：ea77a2f5-b078-486a-afcb-a471cddbc450", message)
        self.assertNotIn("强制限制", message)

    def test_jimeng_upload_failure_is_classified_separately(self):
        failure = jimeng_cli.describe_generation_failure({
            "submit_id": "c707bd90-3b67-46d5-a287-5dbd42619082",
            "gen_status": "fail",
            "fail_reason": 'upload resource "/app/data/uploads/user/ref.png": upload image: upload phase, no file upload',
        })

        self.assertEqual(failure.category, "upload")
        self.assertEqual(failure.title, "参考素材上传失败")

    def test_jimeng_querying_status_is_active(self):
        self.assertTrue(jimeng_cli.is_active_generation_status("querying"))
        self.assertFalse(jimeng_cli.is_failed_generation_status("querying"))

    def test_jimeng_queue_info_is_extracted(self):
        queue_info = jimeng_cli.extract_queue_info({
            "submit_id": "queue-test",
            "gen_status": "querying",
            "queue_info": {
                "queue_idx": 1254,
                "queue_length": 3576,
                "queue_status": 1,
            },
        })

        self.assertEqual(queue_info["position"], 1254)
        self.assertEqual(queue_info["total"], 3576)
        self.assertEqual(queue_info["status"], "1")

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

        paid_request = main.mark_my_recharge_request_paid(recharge_request.id, user)
        still_unchanged_user = main.load_users()[user.email]

        self.assertEqual(paid_request.status, "processing")
        self.assertEqual(still_unchanged_user.creditBalance, 15)
        self.assertEqual(len(main.load_admin_recharge_requests(status="processing")), 1)

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
