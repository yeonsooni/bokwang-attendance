/**
 * 보광중앙교회 청년부 출석부 → 구글 시트 자동 저장
 *
 * 쓰는 법
 *  1. 구글 드라이브에서 새 스프레드시트를 하나 만듭니다.
 *  2. 확장 프로그램 → Apps Script 를 열고, 기본 코드를 지운 뒤 이 파일 내용을 통째로 붙여넣습니다.
 *  3. 아래 SECRET 을 아무 문자열로 바꿉니다 (앱에도 같은 값을 넣게 됩니다).
 *  4. 배포 → 새 배포 → 유형 '웹 앱'
 *       - 실행 계정: 나
 *       - 액세스 권한: 모든 사용자
 *     배포하면 나오는 웹 앱 URL 을 복사합니다.
 *  5. 출석부 앱 → ⚙ 설정 → '구글 시트로 자동 저장' 에 URL 과 SECRET 을 넣습니다.
 *
 * 이후 출석을 체크할 때마다 이 시트가 자동으로 최신 상태로 덮어써집니다.
 */

var SECRET = '여기를-아무-문자열로-바꾸세요';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json({ ok: false, error: 'secret mismatch' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var wrote = [];
    Object.keys(body.sheets).forEach(function (name) {
      writeSheet(ss, name, body.sheets[name]);
      wrote.push(name + '(' + body.sheets[name].length + '행)');
    });

    // 언제 갱신됐는지 남겨둔다
    var meta = sheetNamed(ss, '갱신기록');
    meta.appendRow([new Date(), wrote.join(', ')]);
    if (meta.getLastRow() > 500) meta.deleteRows(2, meta.getLastRow() - 500);

    return json({ ok: true, wrote: wrote, at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** 연결 확인용 — 브라우저에서 URL 을 그냥 열어도 동작 여부를 볼 수 있다 */
function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return json({ ok: true, sheet: ss.getName(), tabs: ss.getSheets().map(function (s) { return s.getName(); }) });
}

function sheetNamed(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === '갱신기록') sh.appendRow(['시각', '갱신한 시트']);
  }
  return sh;
}

function writeSheet(ss, name, rows) {
  var sh = sheetNamed(ss, name);
  sh.clear();
  if (!rows.length) return;

  var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  var padded = rows.map(function (r) {
    var out = r.slice();
    while (out.length < width) out.push('');
    return out;
  });

  sh.getRange(1, 1, padded.length, width).setValues(padded);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f1f5f9');
  sh.setFrozenRows(1);
  if (width > 2) sh.setFrozenColumns(2);
  sh.autoResizeColumns(1, Math.min(width, 3));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
