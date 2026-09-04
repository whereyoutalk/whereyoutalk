# 누구말?

> 말에도 자리가 필요하니까.

한국어 대화를 로컬 GPU에서 실시간으로 받아쓰고 두 사람의 공간 자막으로
보여주는 프로토타입입니다. 외부 API를 사용하지 않으며 음성과 자막을
저장하지 않습니다.

현재 데모 모드는 실제 음성 특징을 비교하지 않습니다. 로컬 STT가 확정한
발화를 `사람 1 → 사람 2 → 사람 1 → 사람 2` 순서로 배정합니다. 사람 1은
왼쪽, 사람 2는 오른쪽에 고정됩니다.

## 실행

처음 한 번:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

실행:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
```

접속 주소는 `http://127.0.0.1:3000`입니다.

종료:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

## 데모 테스트

1. 첫 사람이 한 문장을 말하고 짧게 쉽니다.
2. 두 번째 사람이 한 문장을 말하고 짧게 쉽니다.
3. 첫 사람이 다시 말합니다.
4. 자막이 `사람 1 → 사람 2 → 사람 1`로 나타나는지 확인합니다.

한 사람이 쉬지 않고 여러 문장을 말하거나 한 발화가 둘로 끊기면 순서가
바뀔 수 있습니다. 발표 데모에서는 사람마다 한 문장씩 말하고 약 1초 쉬세요.

## 기술 구성

- 한국어 STT: Nemotron 3.5 ASR Streaming 0.6B, `ko-KR`
- 실행: NeMo-Speech.cpp, CUDA `cuda:0`
- 화자 표시: 확정 발화 순서 기반 2인 교대
- 저장 및 외부 API 전송: 없음
