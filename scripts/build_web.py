"""Builds dist/index.html: one self-contained page (styles, scripts, the demo bank and the template inlined).
The same page is the GitHub Pages site and the macOS app's content. Run scripts/build_demo.py first."""
import base64, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC, DIST = ROOT / 'src', ROOT / 'dist'
SCRIPTS = ['vendor/fflate.js', 'vendor/openai.js', 'platform.js', 'i18n.js', 'i18n-en.js', 'xlsx.js', 'bank.js', 'progress.js', 'ai.js', 'app.js']

def b64(path):
    return base64.b64encode(path.read_bytes()).decode()

def main():
    files = {
        'version': (ROOT / 'VERSION').read_text().strip(),
        'demoZip': b64(ROOT / 'build' / 'demo.zip'),
        'templateXlsx': b64(ROOT / 'demo' / 'template.xlsx'),
    }
    scripts = ['window.DAILY8_FILES=' + json.dumps(files) + ';'] + [(SRC / s).read_text() for s in SCRIPTS]
    # "</script" inside a bundled library would end the inline <script> early.
    body = ''.join('<script>' + s.replace('</script', '<\\/script') + '</script>\n' for s in scripts)
    html = (SRC / 'index.template.html').read_text().replace('<!--STYLE-->', '<style>' + (SRC / 'style.css').read_text() + '</style>').replace('<!--SCRIPTS-->', body)
    DIST.mkdir(exist_ok=True)
    for old in DIST.iterdir():
        old.unlink()
    (DIST / 'index.html').write_text(html)
    (DIST / '.nojekyll').write_text('')
    print('dist/index.html', round(len(html.encode()) / 1024), 'KB')

main()
