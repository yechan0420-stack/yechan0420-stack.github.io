// 방명록 서버 함수 (Netlify Function, Node.js 런타임)
//
// 역할: 브라우저와 Supabase 사이의 서버 중계.
//   - GET  : 최신 방명록 50개 조회
//   - POST : 이름/메시지 저장 (서버에서 재검증)
//
// 비밀 키(SUPABASE_SERVICE_ROLE_KEY)는 이 서버 함수에서만 사용하며,
// Netlify 대시보드의 환경변수로 주입된다. 브라우저로 노출되지 않는다.
//
// 참고: @supabase/supabase-js 의존성이 필요하다 (package.json 참조).
// 로컬에 Node.js/npm 설치 후 `npm install` 하면 Netlify 클라우드 빌드에서 번들된다.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const NAME_MAX = 20;
const MESSAGE_MAX = 200;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: '서버 환경변수가 설정되지 않았습니다.' });
  }

  // 디버그: 환경변수 형태 확인(값 자체는 노출하지 않고 앞부분/길이만)
  console.log('DBG url starts:', String(SUPABASE_URL).slice(0, 30));
  console.log('DBG key prefix:', String(SUPABASE_SERVICE_ROLE_KEY).slice(0, 10), 'len:', String(SUPABASE_SERVICE_ROLE_KEY).length);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 조회
  // 주의: Supabase/PostgREST는 기본 조회 건수 상한이 있다(기본 1000행).
  // 이 MVP는 "최신 50개 표시"가 명세이므로 limit(50)은 의도된 제한이다.
  // total(전체 건수)을 함께 반환해 "표시된 것보다 더 많은지"를 알 수 있게 한다.
  // 전체를 모두 읽어야 하는 집계가 필요해지면, 아래처럼 range()로
  // 페이지를 끝까지 넘겨 누락 없이 모으는 방식으로 확장한다(현재는 불필요).
  if (event.httpMethod === 'GET') {
    const LIMIT = 50;
    const { data, error, count } = await supabase
      .from('guestbook')
      .select('id, name, message, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(LIMIT);

    if (error) {
      console.error('DBG GET supabase error:', JSON.stringify(error));
      return json(502, { error: '메시지를 불러오지 못했어요.' });
    }
    return json(200, { entries: data, total: count, shown: data.length, limit: LIMIT });
  }

  // 저장
  if (event.httpMethod === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: '잘못된 요청 형식입니다.' });
    }

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';

    // 서버 측 재검증 (클라이언트 검증을 신뢰하지 않음)
    if (!name || !message) {
      return json(400, { error: '이름과 메시지를 입력해 주세요.' });
    }
    if (name.length > NAME_MAX || message.length > MESSAGE_MAX) {
      return json(400, { error: '글자 수를 줄여 주세요.' });
    }

    const { data, error } = await supabase
      .from('guestbook')
      .insert({ name, message })
      .select('id, name, message, created_at')
      .single();

    if (error) {
      console.error('DBG POST supabase error:', JSON.stringify(error));
      return json(502, { error: '저장에 실패했어요. 잠시 후 다시 시도해 주세요.' });
    }
    return json(201, { entry: data });
  }

  return json(405, { error: '허용되지 않은 메서드입니다.' });
};
