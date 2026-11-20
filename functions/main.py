"""Cloud Functions for Sieve (docs/spec/30-relay-server.md section 2.5). Declarations only."""
from firebase_functions import https_fn, options, scheduler_fn

from sieve import callables, cleanup, config, fb, mcp_server

options.set_global_options(region=config.REGION, max_instances=10)

# The callable wrapper verifies ID and App Check tokens with the default admin app before our code runs.
fb.app()


@https_fn.on_request(
    memory=options.MemoryOption.MB_512, cpu=1, concurrency=20, timeout_sec=70,
    min_instances=config.MCP_MIN_INSTANCES, max_instances=10,
    secrets=[config.BROKER_SECRET], invoker="public",
)
def mcp(req: https_fn.Request) -> https_fn.Response:
    return mcp_server.handle_http(req)


_CALLABLE = dict(
    enforce_app_check=config.ENFORCE_APP_CHECK,
    cors=options.CorsOptions(cors_origins=list(config.APP_ORIGINS), cors_methods=["post"]),
    memory=options.MemoryOption.MB_512, timeout_sec=60,
)


@https_fn.on_call(secrets=[config.BROKER_SECRET], **_CALLABLE)
def issueGrant(req: https_fn.CallableRequest) -> dict:
    return callables.issue_grant(req)


@https_fn.on_call(secrets=[config.BROKER_SECRET], **_CALLABLE)
def issuePlaygroundGrant(req: https_fn.CallableRequest) -> dict:
    return callables.issue_playground_grant(req)


@https_fn.on_call(secrets=[config.BROKER_SECRET], **_CALLABLE)
def narrowGrant(req: https_fn.CallableRequest) -> dict:
    return callables.narrow_grant(req)


@https_fn.on_call(**_CALLABLE)
def revokeGrant(req: https_fn.CallableRequest) -> dict:
    return callables.revoke_grant(req)


@https_fn.on_call(**_CALLABLE)
def getAuditStatus(req: https_fn.CallableRequest) -> dict:
    return callables.get_audit_status(req)


@https_fn.on_call(**_CALLABLE)
def deleteAccount(req: https_fn.CallableRequest) -> dict:
    return callables.delete_account(req)


@scheduler_fn.on_schedule(schedule="*/15 * * * *", timezone=scheduler_fn.Timezone("Etc/UTC"),
                          memory=options.MemoryOption.MB_512, timeout_sec=300)
def cleanupRelay(event: scheduler_fn.ScheduledEvent) -> None:
    cleanup.run_scheduled()
