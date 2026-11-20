import base64
import json

import anyio
from mcp import Client
from mcp.types import ImageContent, TextContent

from sieve_bench.baseline_server import DESCRIPTIONS, SERVER_NAME, build_server, http_app
from sieve_bench.log import read_jsonl
from sieve_bench.mcp_client import connect

from conftest import UvicornThread, free_port


def call(server, name, args):
    async def go():
        async with Client(server) as c:
            return await c.call_tool(name, args)

    return anyio.run(go)


def text_of(result):
    return "\n".join(b.text for b in result.content if isinstance(b, TextContent))


def test_tools_list_shows_the_four_tools_with_exact_descriptions(dataset, server_log):
    async def go():
        async with Client(build_server(dataset)) as c:
            return (await c.list_tools()).tools, c.server_info

    tools, info = anyio.run(go)
    assert [t.name for t in tools] == ["search_mail", "read_mail", "search_files", "read_file"]
    assert {t.name: t.description for t in tools} == DESCRIPTIONS
    assert info.name == SERVER_NAME
    by_name = {t.name: t for t in tools}
    assert by_name["search_mail"].input_schema["required"] == ["query"]
    assert by_name["search_mail"].input_schema["properties"]["max_results"]["default"] == 10
    assert all(t.output_schema is None for t in tools)


def test_search_mail_returns_the_documented_json(dataset, server_log):
    result = call(build_server(dataset), "search_mail", {"query": "flight Seattle"})
    data = json.loads(text_of(result))
    assert list(data) == ["messages"]
    first = data["messages"][0]
    assert list(first) == ["id", "from", "to", "date", "subject", "snippet"]
    assert first["id"] == "pg-mail-19"
    assert len(first["snippet"]) <= 200 and "\n" not in first["snippet"]
    assert result.structured_content is None


def test_max_results_is_clamped(dataset, server_log):
    server = build_server(dataset)
    many = json.loads(text_of(call(server, "search_mail", {"query": "alex deposit order flight", "max_results": 100})))
    one = json.loads(text_of(call(server, "search_mail", {"query": "alex deposit order flight", "max_results": 0})))
    assert len(many["messages"]) <= 25 and len(one["messages"]) == 1


def test_read_mail_returns_the_whole_email(dataset, server_log):
    data = json.loads(text_of(call(build_server(dataset), "read_mail", {"id": "pg-mail-02"})))
    assert list(data) == ["id", "from", "to", "date", "subject", "body"]
    assert "$1,200 on March 3" in data["body"]


def test_unknown_id_returns_the_error_json(dataset, server_log):
    server = build_server(dataset)
    assert json.loads(text_of(call(server, "read_mail", {"id": "pg-mail-99"}))) == {"error": "not found"}
    assert json.loads(text_of(call(server, "read_file", {"id": "pg-mail-02"}))) == {"error": "not found"}


def test_search_files_matches_photos_by_file_name_only(dataset, server_log):
    server = build_server(dataset)
    by_words = json.loads(text_of(call(server, "search_files", {"query": "hot dogs mouth"})))
    assert all(f["mime"] != "image/jpeg" for f in by_words["files"])
    by_name = json.loads(text_of(call(server, "search_files", {"query": "IMG_4821"})))
    assert by_name["files"][0]["id"] == "pg-photo-01"
    assert list(by_name["files"][0]) == ["id", "name", "mime", "modified", "size_bytes"]


def test_read_file_document_returns_its_text(dataset, server_log):
    data = json.loads(text_of(call(build_server(dataset), "read_file", {"id": "pg-doc-01"})))
    assert list(data) == ["id", "name", "mime", "text"]
    assert data["mime"] == "application/pdf" and "12. Pets." in data["text"]


def test_read_file_photo_returns_an_image_item_with_the_original_bytes(dataset, server_log):
    result = call(build_server(dataset), "read_file", {"id": "pg-photo-01"})
    image = [b for b in result.content if isinstance(b, ImageContent)]
    assert len(image) == 1 and image[0].mime_type == "image/jpeg"
    assert base64.b64decode(image[0].data) == dataset.get("pg-photo-01").file_bytes()
    assert json.loads(text_of(result)) == {"id": "pg-photo-01", "name": "IMG_4821.jpg", "mime": "image/jpeg"}


def test_every_call_writes_a_server_log_line(dataset, server_log):
    server = build_server(dataset)
    texts = [
        text_of(call(server, "search_mail", {"query": "landlord deposit"})),
        text_of(call(server, "read_mail", {"id": "pg-mail-02"})),
        text_of(call(server, "read_file", {"id": "nope"})),
    ]
    rows = read_jsonl(server_log)
    assert [r["tool"] for r in rows] == ["search_mail", "read_mail", "read_file"]
    assert [r["result_chars"] for r in rows] == [len(t) for t in texts]
    assert rows[1]["item_ids"] == ["pg-mail-02"] and rows[2]["item_ids"] == []
    assert set(rows[0]) == {"ts", "run", "tool", "args", "result_chars", "item_ids"}


def test_http_round_trip_tags_log_lines_with_the_run_header(dataset, server_log):
    port = free_port()
    url = f"http://127.0.0.1:{port}/mcp"

    async def go():
        async with connect(url, headers={"X-Bench-Run": "set1-baseline-1"}) as tools:
            specs = await tools.list_tools()
            outcome = await tools.call("read_file", {"id": "pg-photo-01"})
            return specs, outcome

    with UvicornThread(http_app(dataset), port):
        specs, outcome = anyio.run(go)
    assert [s["name"] for s in specs] == ["search_mail", "read_mail", "search_files", "read_file"]
    assert "title" not in specs[0]["parameters"] and "title" not in specs[0]["parameters"]["properties"]["query"]
    assert outcome.images and outcome.images[0][1] == "image/jpeg"
    rows = read_jsonl(server_log)
    assert rows[-1]["run"] == "set1-baseline-1" and rows[-1]["result_chars"] == len(outcome.text)
