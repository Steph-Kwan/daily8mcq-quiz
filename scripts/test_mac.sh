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
assert a['imageBlock'] in ('image/png', 'image/jpeg') and a['markdownSafe'], a
assert b['phase'] == 'read' and b['banks'] == ['selftest', '示例题库'] and b['history'] == 1 and b['keychain'], b
print('PASS: demo bank + images, import, session, review schedule, dialog, SDK auth error in WebKit, Keychain, data survives relaunch')
PY
