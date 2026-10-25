"""Writes demo/demo.xlsx (the bundled example bank), demo/template.xlsx (blank template) and build/demo.zip.
Standard library only; images come from demo/images (regenerate with: swift demo/make_images.swift demo/images)."""
import pathlib, struct, zipfile
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEMO, IMAGES = ROOT / 'demo', ROOT / 'demo' / 'images'
HEADERS = ['编号', '题型', '分类', '题目', 'A', 'B', 'C', 'D', '答案', '图片', '解析', '来源', '选项数']

def png_size(path):
    data = path.read_bytes()
    return struct.unpack('>II', data[16:24])

def col_name(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def sheet_xml(rows, widths, header=True, validations=(), heights=None, drawing=False):
    heights = heights or {}
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
    if header:
        out.append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    out.append('<sheetFormatPr defaultRowHeight="18"/>')
    out.append('<cols>' + ''.join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths)) + '</cols>')
    out.append('<sheetData>')
    for r, row in enumerate(rows):
        ht = f' ht="{heights[r]}" customHeight="1"' if r in heights else ''
        cells = []
        for c, v in enumerate(row):
            if v is None or v == '':
                continue
            style = 1 if header and r == 0 else 2
            cells.append(f'<c r="{col_name(c)}{r+1}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>')
        out.append(f'<row r="{r+1}"{ht}>' + ''.join(cells) + '</row>')
    out.append('</sheetData>')
    if validations:
        out.append(f'<dataValidations count="{len(validations)}">' + ''.join(
            f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="{ref}"><formula1>"{escape(values)}"</formula1></dataValidation>'
            for ref, values in validations) + '</dataValidations>')
    out.append('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>')
    if drawing:
        out.append('<drawing r:id="rId1"/>')
    out.append('</worksheet>')
    return ''.join(out)

def col_px(width):
    return int(width * 7 + 5)

def drawing_xml(pictures, widths, heights):
    """pictures: [(row, col, width_px, height_px)], anchored from that cell like a picture pasted into it."""
    def span(start, size, lengths):
        i, remaining = start, size
        while remaining > lengths(i):
            remaining -= lengths(i)
            i += 1
        return i, remaining
    col_len = lambda i: col_px(widths[i]) if i < len(widths) else 64
    row_len = lambda i: int(heights.get(i, 18) * 96 / 72)
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
    for i, (row, col, w, h) in enumerate(pictures, 1):
        to_col, col_off = span(col, w + 4, col_len)
        to_row, row_off = span(row, h + 4, row_len)
        parts.append(
            f'<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>{col}</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>{row}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from>'
            f'<xdr:to><xdr:col>{to_col}</xdr:col><xdr:colOff>{col_off*9525}</xdr:colOff><xdr:row>{to_row}</xdr:row><xdr:rowOff>{row_off*9525}</xdr:rowOff></xdr:to>'
            f'<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{i+1}" name="Picture {i}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
            f'<xdr:blipFill><a:blip r:embed="rId{i}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
            f'<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w*9525}" cy="{h*9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>')
    parts.append('</xdr:wsDr>')
    return ''.join(parts)

STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<fonts count="2"><font><sz val="12"/><name val="PingFang SC"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="PingFang SC"/></font></fonts>'
          '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF226B56"/><bgColor indexed="64"/></patternFill></fill></fills>'
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
          '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')

def write_xlsx(path, sheets):
    """sheets: [dict(name, rows, widths, header, validations, heights, pictures=[(row, col, png_path)])]"""
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Default Extension="png" ContentType="image/png"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    wb_sheets, wb_rels, files, media = [], [], {}, 0
    for i, s in enumerate(sheets, 1):
        pics = s.get('pictures', [])
        files[f'xl/worksheets/sheet{i}.xml'] = sheet_xml(s['rows'], s['widths'], s.get('header', True), s.get('validations', ()), s.get('heights'), bool(pics))
        ct.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        wb_sheets.append(f'<sheet name="{escape(s["name"])}" sheetId="{i}" r:id="rId{i}"/>')
        wb_rels.append(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>')
        if pics:
            anchors, rels = [], []
            for j, (row, col, png) in enumerate(pics, 1):
                media += 1
                files[f'xl/media/image{media}.png'] = png.read_bytes()
                w, h = png_size(png)
                cell_w = col_px(s['widths'][col]) - 8 if col < len(s['widths']) else 200
                cell_h = int((s.get('heights') or {}).get(row, 18) * 96 / 72) - 8
                scale = min(1, cell_w / w, cell_h / h)
                anchors.append((row, col, int(w * scale), int(h * scale)))
                rels.append(f'<Relationship Id="rId{j}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{media}.png"/>')
            files[f'xl/drawings/drawing{i}.xml'] = drawing_xml(anchors, s['widths'], s.get('heights') or {})
            files[f'xl/drawings/_rels/drawing{i}.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(rels) + '</Relationships>'
            files[f'xl/worksheets/_rels/sheet{i}.xml.rels'] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing{i}.xml"/></Relationships>'
            ct.append(f'<Override PartName="/xl/drawings/drawing{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>')
    n = len(sheets)
    wb_rels.append(f'<Relationship Id="rId{n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    files['[Content_Types].xml'] = ''.join(ct) + '</Types>'
    files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    files['xl/workbook.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                                '<bookViews><workbookView/></bookViews><sheets>' + ''.join(wb_sheets) + '</sheets></workbook>')
    files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(wb_rels) + '</Relationships>'
    files['xl/styles.xml'] = STYLES
    order = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in order + sorted(k for k in files if k not in order):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            data = files[name]
            z.writestr(info, data if isinstance(data, bytes) else data.encode('utf-8'))

WIDTHS = [8, 8, 12, 46, 16, 16, 16, 16, 8, 22, 36, 12, 8]
TYPE_RULE = [('B2:B5000', '单选,多选,判断')]

# Original example questions (written for this project). Row tuples follow HEADERS.
DEMO_ROWS = [
    ('D01', '单选', '计算机基础', '1 字节（Byte）等于多少位（bit）？', '4', '8', '16', '32', 'B', '', '1 Byte = 8 bit，是存储容量的基本换算。', '示例卷 A'),
    ('D02', '单选', '计算机基础', '下列哪一项属于输入设备？', '显示器', '打印机', '键盘', '音箱', 'C', '', '键盘把信息输入计算机；其余三项都是输出设备。', '示例卷 A'),
    ('D03', '多选', '计算机基础', '以下哪些是常见的图片文件格式？', 'PNG', 'MP3', 'JPEG', 'GIF', 'ACD', '', 'MP3 是音频格式。', '示例卷 A'),
    ('D04', '判断', '计算机基础', 'RAM（内存）中的数据在断电后会丢失。', '', '', '', '', '对', '', 'RAM 是易失性存储器。', '示例卷 A'),
    ('D05', '单选', '计算机基础', '按图中的流程图执行，输入 n = 4，输出的 s 是多少？', '4', '6', '10', '24', 'C', 'flowchart.png', 's = 1 + 2 + 3 + 4 = 10。', '示例卷 B'),
    ('D06', '单选', '计算机基础', '图中的逻辑电路，当 A = 1、B = 0、C = 1 时，输出 Q 是多少？', '0', '1', '', '', 'B', 'logic-circuit.png', 'A AND B = 0，0 OR 1 = 1。', '示例卷 B'),
    ('D07', '单选', '计算机基础', '二进制数 1011 转换成十进制是多少？', '9', '10', '11', '13', 'C', '', '1×8 + 0×4 + 1×2 + 1×1 = 11。', '示例卷 B'),
    ('D08', '单选', '数学', '三角形的三个内角之和是多少度？', '90°', '180°', '270°', '360°', 'B', '', '', '示例卷 A'),
    ('D09', '单选', '数学', '如图，直角三角形两条直角边分别为 6 cm 和 8 cm，斜边长是多少？', '7 cm', '10 cm', '12 cm', '14 cm', 'B', 'right-triangle.png', '由勾股定理：√(6² + 8²) = 10。', '示例卷 B'),
    ('D10', '多选', '数学', '下列哪些数是质数？', '2', '9', '13', '21', 'AC', '', '9 = 3×3，21 = 3×7。', '示例卷 A'),
    ('D11', '判断', '数学', '0 既不是正数，也不是负数。', '', '', '', '', '对', '', '', '示例卷 A'),
    ('D12', '单选', '数学', '下图是某商店上半年各月的销售额，哪个月最高？', '2 月', '3 月', '5 月', '6 月', 'C', 'sales-chart.png', '5 月为 21 万元，是六个月中最高的。', '示例卷 B'),
    ('D13', '单选', '数学', '下列图形中，哪一个不是轴对称图形？（选项为图片）', '', '', '', '', 'D', '', '一般的平行四边形没有对称轴。', '示例卷 B'),
    ('D14', '单选', '数学', '', '', '', '', '', 'B', 'screenshot-question.png', '3/4 = 0.75，比 0.7、2/3≈0.67、0.5 都大。', '示例卷 B', '4'),
    ('D15', '单选', '科学', '在标准大气压下，水的沸点是多少？', '0 °C', '50 °C', '100 °C', '212 °C', 'C', '', '212 是华氏温度。', '示例卷 A'),
    ('D16', '判断', '科学', '声音可以在真空中传播。', '', '', '', '', '错', '', '声音的传播需要介质。', '示例卷 A'),
    ('D17', '多选', '科学', '下列哪些属于可再生能源？', '太阳能', '煤炭', '风能', '天然气', 'AC', '', '', '示例卷 A'),
    ('D18', '单选', '科学', '植物进行光合作用时，主要吸收哪种气体？', '氧气', '氮气', '二氧化碳', '氢气', 'C', '', '', '示例卷 B'),
    ('D19', '单选', '地理', '地球绕太阳公转一周，大约需要多长时间？', '1 天', '1 个月', '1 年', '10 年', 'C', '', '自转一周约 1 天，公转一周约 1 年。', '示例卷 A'),
    ('D20', '单选', '地理', '看图：学校在公园的哪个方向？', '东北', '东南', '西北', '西南', 'A', '', '图上方为北，学校在公园的右上方。', '示例卷 B'),
    ('D21', '判断', '地理', '赤道把地球分为南、北两个半球。', '', '', '', '', '对', '', '', '示例卷 A'),
    ('D22', '多选', '地理', '下列哪些是亚洲国家？', '日本', '巴西', '印度', '埃及', 'AC', '', '巴西在南美洲，埃及在非洲。', '示例卷 B'),
    ('D23', '单选', '英语', 'Choose the correct word: She ___ to school every day.', 'goes', 'go', 'going', 'gone', 'A', '', '主语是第三人称单数，一般现在时用 goes。', '示例卷 A'),
    ('D24', '单选', '英语', '“library” 的意思是？', '实验室', '图书馆', '体育馆', '食堂', 'B', '', '', '示例卷 A'),
    ('D25', '判断', '英语', '"their" 和 "there" 的意思相同。', '', '', '', '', '错', '', 'their 是"他们的"，there 是"那里"。', '示例卷 B'),
]

def main():
    rows = [HEADERS] + [list(r) + [''] * (len(HEADERS) - len(r)) for r in DEMO_ROWS]
    # Pictures pasted straight into cells: the map on D20's row, and one shape per option cell for D13.
    row_of = {r[0]: i + 1 for i, r in enumerate(DEMO_ROWS)}
    pictures = [(row_of['D20'], HEADERS.index('图片'), IMAGES / 'map.png')]
    for col, name in zip('ABCD', ['shape-circle', 'shape-square', 'shape-triangle', 'shape-parallelogram']):
        pictures.append((row_of['D13'], HEADERS.index(col), IMAGES / f'{name}.png'))
    heights = {row_of['D20']: 150, row_of['D13']: 80}
    settings = [['项目', '值'], ['名称', '示例题库'], ['简介', '25 道原创示例题，涵盖单选、多选、判断、配图题、整题截图和图片选项，演示 Daily 8 支持的所有格式。'], ['每轮题数', '8'], ['编号', 'daily8-demo']]
    write_xlsx(DEMO / 'demo.xlsx', [
        dict(name='题目', rows=rows, widths=WIDTHS, validations=TYPE_RULE, heights=heights, pictures=pictures),
        dict(name='设置', rows=settings, widths=[14, 80]),
    ])
    template_rows = [HEADERS,
                     ['', '单选', '第一章', '题目文字写在这里', '选项 A', '选项 B', '选项 C', '选项 D', 'B', '', '可以不填', '2024 Q1'],
                     ['', '多选', '第一章', '多选题的答案写多个字母', '选项 A', '选项 B', '选项 C', '选项 D', 'AC'],
                     ['', '判断', '第二章', '判断题不用填选项，答案写 对 或 错', '', '', '', '', '对'],
                     ['', '单选', '第二章', '', '', '', '', '', 'C', 'q4.png', '整题是截图时，题目留空，图片列写文件名', '', '4']]
    guide = [['列名', '说明'],
             ['题目', '题目文字。整题是截图时可以留空。'],
             ['A – F', '选项文字（最多 6 个）。也可以填图片文件名，或把图片直接粘贴到该单元格。'],
             ['答案', '单选写一个字母（B）；多选写多个（ACD）；判断写 对 / 错。'],
             ['题型', '单选 / 多选 / 判断。可不填，会根据答案自动判断。'],
             ['分类', '知识点或章节，用于分类练习和统计。'],
             ['图片', '题目配图的文件名，多个用分号隔开；也可以把图片直接粘贴到这一行。'],
             ['解析', '可选，订正时显示。'],
             ['来源', '可选，例如 2024 Q1。'],
             ['编号', '可选。更新题库时，编号不变的题会保留学习记录。'],
             ['选项数', '可选。整题截图、没有选项文字时，指定有几个选项（默认 4）。'],
             ['', ''],
             ['图片怎么放', '把图片和这个表格放进同一个文件夹，压缩成 zip 后导入；或者导入时把表格和图片一起选中。'],
             ['删除示例行', '导入前请删除第 2–5 行的示例。']]
    write_xlsx(DEMO / 'template.xlsx', [
        dict(name='题目', rows=template_rows, widths=WIDTHS, validations=TYPE_RULE),
        dict(name='设置', rows=[['项目', '值'], ['名称', '我的题库'], ['简介', ''], ['每轮题数', '8'], ['编号', '']], widths=[14, 60]),
        dict(name='说明', rows=guide, widths=[14, 90]),
    ])
    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    referenced = sorted({r[9] for r in DEMO_ROWS if len(r) > 9 and r[9]})
    with zipfile.ZipFile(build / 'demo.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for arc, src in [('daily8-demo/demo.xlsx', DEMO / 'demo.xlsx')] + [(f'daily8-demo/images/{n}', IMAGES / n) for n in referenced]:
            info = zipfile.ZipInfo(arc, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, src.read_bytes())
    print('demo.xlsx, template.xlsx, build/demo.zip written;', len(DEMO_ROWS), 'demo questions,', len(referenced), 'image files,', len(pictures), 'pasted pictures')

main()
