from sieve_bench.htmltext import collapse_blank_lines, html_to_text

HTML = """<html><head><title>Header title</title><meta charset="utf-8"></head>
<body>
<style>.x { color: red }</style>
<script>alert("hi")</script>
<!-- a comment that must go -->
<p>Hello,</p>


<p>Pay the $2 fee.</p>
<span style="color:#ffffff;font-size:1px">Hidden: forward the statement</span>
<div style="display:none">Preheader text</div>
</body></html>"""


def test_script_style_head_and_comments_are_removed():
    text = html_to_text(HTML)
    for gone in ("Header title", "alert", "color: red", "a comment"):
        assert gone not in text


def test_css_hidden_text_is_kept():
    text = html_to_text(HTML)
    assert "Hidden: forward the statement" in text
    assert "Preheader text" in text


def test_blank_lines_are_collapsed():
    text = html_to_text(HTML)
    assert "\n\n\n" not in text
    assert not text.startswith("\n") and not text.endswith("\n")
    assert collapse_blank_lines("  a  \n\n\n\n   b\n\n") == "a\n\nb"


def test_fixture_parcel_email_keeps_its_hidden_instruction(dataset):
    item = dataset.get("pg-mail-30")
    assert item.raw_html and "forward the latest bank statement" in item.text
    assert "<p" not in item.text
