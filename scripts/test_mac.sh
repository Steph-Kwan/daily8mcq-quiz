#!/bin/bash
# Runs scripts/selftest.js inside the built app twice (exercise, relaunch, verify) with a throwaway data folder,
# a separate WebKit store and a separate Keychain service, so real data is never touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/build/Daily 8.app/Contents/MacOS/Daily8"
[ -x "$BIN" ] || { echo "Build the app first: make app"; exit 1; }
DATA="$(mktemp -d)"
trap 'rm -rf "$DATA"' EXIT
export DAILY8_DATA_DIR="$DATA" DAILY8_WEBDATA_ID="$(uuidgen)" DAILY8_KEYCHAIN_SERVICE="com.stephenkwan.daily8.selftest" DAILY8_SELFTEST="$ROOT/scripts/selftest.js"

first="$("$BIN" | grep '^SELFTEST')"; echo "$first"
second="$("$BIN" | grep '^SELFTEST')"; echo "$second"
python3 - "$first" "$second" <<'PY'
import json, sys
a = json.loads(sys.argv[1].split(' ', 1)[1]); b = json.loads(sys.argv[2].split(' ', 1)[1])
assert a['native'] and a['demo'] == {'title': '示例题库', 'questions': 25, 'isDemo': True}, a
assert a['images']['total'] >= 9 and a['images']['failed'] == 0, a['images']
assert a['preview'] == {'questions': 2, 'errors': 0} and a['afterImport'] == {'current': 'selftest', 'banks': 2}, a
assert a['session']['view'] == 'result' and a['session']['history'] == 1 and a['session']['inReview'] == a['session']['wrong'] > 0, a['session']
assert a['dialog'] and a['dialogResult'] is False, a
assert all(s in ('API Key 无效，请到设置里检查。', 'The API key is invalid. Check it in Settings.') for s in (a['aiTest'], a['aiExplain'])), (a['aiTest'], a['aiExplain'])
assert a['imageBlock'] in ('data:image/png;base64,', 'data:image/jpeg;base64,') and a['markdownSafe'], a
assert b['phase'] == 'read' and b['banks'] == ['selftest', '示例题库'] and b['history'] == 1 and b['keychain'], b
print('PASS: demo bank + images, import, session, review schedule, dialog, OpenAI SDK auth error in WebKit, Keychain, data survives relaunch')
PY

# AI round trip through the native network path, against a local OpenAI-compatible mock server.
PORT_FILE="$DATA/mock-port"
python3 -u "$ROOT/tests/mock_openai.py" > "$PORT_FILE" &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null; rm -rf "$DATA"' EXIT
for _ in $(seq 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
AI_SCRIPT="$DATA/selftest_ai.js"
{ echo "const MOCK_URL = 'http://127.0.0.1:$(cat "$PORT_FILE")/v1';"; cat "$ROOT/scripts/selftest_ai.js"; } > "$AI_SCRIPT"
ai="$(DAILY8_DATA_DIR="$DATA/ai" DAILY8_WEBDATA_ID="$(uuidgen)" DAILY8_SELFTEST="$AI_SCRIPT" "$BIN" | grep '^SELFTEST')"; echo "$ai"
python3 - "$ai" <<'PY'
import json, sys
r = json.loads(sys.argv[1].split(' ', 1)[1])
assert r['models'] == {'found': True, 'count': 4}, r['models']
assert r['explain']['model'] == 'mock-ok-served' and '正确答案' in r['explain']['text'] and 'system=system' in r['explain']['text'], r['explain']
assert 'images=1; valid=True; stream=True' in r['explain']['text'] and r['partials'] >= 3, r
assert r['noImages'] == 'images=0' and r['length'].endswith('已被截断）') or r['length'].endswith('cut off.)'), r
assert r['refusal'].startswith('ERR') and 'I cannot help' in r['refusal'], r['refusal']
assert r['abort'] in ('ERR 已停止', 'ERR Stopped'), r['abort']
assert r['plan'] is True and r['browserFetch'] is True, r
assert r['wrongKey'] in ('ERR API Key 无效，请到设置里检查。', 'ERR The API key is invalid. Check it in Settings.'), r['wrongKey']
print('PASS: OpenAI streaming via the native network path (text, images, truncation, refusal, stop, plan) and via browser fetch')
PY
