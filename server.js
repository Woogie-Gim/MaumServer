require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// LLM이 한국어에 섞어 내보내는 한자·CJK 문자를 제거하는 안전장치
// 프롬프트만으로는 100% 안 잡히므로 응답 후처리로 확실히 걸러냄
function stripNonKorean(text) {
  return text
    // 한중일 통합 한자 영역 제거 (你, 的 같은 중국어 글자)
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, '')
    // 한자 제거 후 생긴 이중 공백 정리
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 간단한 인메모리 리더보드 (추후 DB로 교체 가능)
let leaderboard = [];

// 정원사 조언 + 축복치
app.post('/api/blessing', async (req, res) => {
  const { diary, weather } = req.body;

  // 입력 검증
  if (!diary || typeof diary !== 'string') {
    return res.status(400).json({ message: '일기를 입력해 주세요.', blessing: 50 });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
                   content: '너는 "정원의 목소리"라는 힐링 게임 속 다정한 AI 정원사야. ' +
         '플레이어의 일기를 읽고 공감과 조언을 담은 따뜻한 한두 문장과, ' +
         '일기의 긍정도를 0~100 정수로 평가한 값을 반환해. ' +
         '반드시 순수 한국어로만 작성하고, 한자·중국어·영어 단어를 절대 섞지 마. ' +
         '한글이 아닌 문자가 하나라도 포함되면 안 돼. 예를 들어 "你", "的", "하는中" 같은 표현은 절대 금지야. ' +
         '반드시 JSON 형식으로만 답해: {"message": "...", "blessing": 정수}',
        },
        {
          role: 'user',
          content: `오늘 날씨: ${weather || '맑음'}\n일기: ${diary}`,
        },
      ],
      response_format: { type: 'json_object' },  // JSON 강제
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    // 방어적 처리
    const message = parsed.message || '오늘도 수고했어요.';
    message = stripNonKorean(message);   // 한자·중국어 문자 제거 (시연 중 사고 방지)
    let blessing = parseInt(parsed.blessing, 10);
    if (isNaN(blessing)) blessing = 50;
    blessing = Math.max(0, Math.min(100, blessing));

    console.log(`[조언] ${message} | 축복치: ${blessing}`);
    res.json({ message, blessing });

  } catch (err) {
    console.error('Groq 호출 실패:', err.message);
    // 실패해도 게임이 멈추지 않게 폴백
    res.json({ message: '정원사가 잠시 자리를 비웠어요. 그래도 정원은 잘 자라고 있답니다.', blessing: 50 });
  }
});

// 점수 등록
app.post('/api/score', (req, res) => {
  const { name, score } = req.body;
  if (!name || typeof score !== 'number') {
    return res.status(400).json({ ok: false });
  }
  leaderboard.push({ name, score, at: Date.now() });
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 100);  // 상위 100명만
  res.json({ ok: true, rank: leaderboard.findIndex(e => e.name === name && e.score === score) + 1 });
});

// 리더보드 조회
app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 20));  // 상위 20명
});

// 헬스 체크
app.get('/', (req, res) => res.send('Maum Server 작동 중'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행: ${PORT}`));