# Supabase 연결 준비

현재 준비 상태(2026-09-22 실제 읽기 전용 확인): DATABASE_URL/Transaction pooler와 DIRECT_URL/Session pooler 모두 TLS 1.3·서버 인증서/hostname 검증을 포함한 READ ONLY SELECT 1 성공. Storage 인증 읽기 HTTP 200. public 테이블 0개, gs-hale-private 버킷 없음. 원격 데이터 변경 0회. 앱 통합/Vercel 환경변수 검증은 미실행. 연결 자격증명 준비는 완료됐다. 버킷·앱 테이블 생성은 Goal 재개 후 비파괴 준비 단계에서 수행한다. 이 문서는 준비 안내이며 앱은 아직 `DATA_SOURCE=supabase`를 지원하지 않는다. 설정만으로 현재 배포가 바로 전환되지는 않는다.

## 사용자가 준비할 값

Supabase 프로젝트를 생성하거나 이 앱에 사용할 프로젝트를 지정한다. 기존 데이터가 있으면 알려준다. 연결 문자열·DB 비밀번호·secret key는 채팅/문서/Git에 붙이지 말고 `/Users/evan/workspace/gs-hale/.env`에 직접 추가한다. 기존 OpenAI 변수는 유지한다.

| 이름 | 찾는 위치 / 용도 |
| --- | --- |
| `DATABASE_URL` | Supabase 프로젝트 → Connect → **Direct (Connection string)** 탭 → Transaction pooler URI. Vercel runtime용. 보통 6543 포트이며 화면의 실제 값을 사용 |
| `DIRECT_URL` | 같은 **Direct (Connection string)** 탭 → Session pooler URI(일반적으로 5432), migration/seed 전용. IPv6가 가능한 실행 환경에서는 Direct connection도 가능. 화면의 실제 값을 사용 |
| `SUPABASE_URL` | 프로젝트 API URL, 예: `https://PROJECT_REF.supabase.co` |
| `SUPABASE_SECRET_KEY` | Settings → API Keys의 서버 Secret key. `sb_secret_...` 값을 서버에만 설정. publishable key와 혼동하지 않음 |
| `SUPABASE_STORAGE_BUCKET` | `gs-hale-private`을 기본 이름으로 사용. private 버킷이어야 함 |

URI에 `[YOUR-PASSWORD]` placeholder가 있으면 실제 DB 비밀번호로 바꾸고 특수문자는 URI 규칙에 맞게 인코딩한다. 값 전체를 출력하는 진단 명령은 사용하지 않는다. 새 secret key가 없고 legacy service-role key만 제공되는 경우 그 사실만 알린다. 자동 fallback은 구현자가 확인 후 문서화하며 둘을 혼동하지 않는다.

변경할 환경 이름만 아래에 표시한다. **현재 production의 DATA_SOURCE는 코드 전환 완료 전 바꾸지 않는다.**

```dotenv
# 전환 구현 후 사용하는 설정 이름. 실제 비밀값은 여기에 작성하지 않는다.
DATA_SOURCE=supabase
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=gs-hale-private
APP_ORIGIN=https://g-30-pi.vercel.app
```

`.env.supabase.example`은 위 항목의 비밀값 없는 예시다. `.env`를 덮어쓰는 복사 명령을 사용하지 않는다. localhost 검증에서는 테스트 서버의 정확한 origin을 프로세스 환경으로 주입하고 production origin을 재사용하지 않는다. Preview URL도 요청 origin이 달라지므로 환경별로 명시한 신뢰 origin을 사용하며 모든 Origin을 허용하는 우회로 고치지 않는다.

## TLS 인증서 확인 결과

기본 Node 신뢰 저장소만 사용한 첫 진단은 `SELF_SIGNED_CERT_IN_CHAIN`으로 실패했다. Supabase Studio 공식 소스가 지정한 [공식 production CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)를 적용한 뒤 두 연결 모두 서버 인증서·hostname 검증과 실제 조회에 성공했다. 인증서 검증을 끄지 않았다. 구현자는 CA 출처/해시/유효기간을 기록하고 런타임·migration에 같은 검증을 적용한다. 이번 CA 파일의 SHA-256은 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`이다.

Supavisor 뒤의 `pg_stat_ssl`은 클라이언트→pooler TLS 자체의 증거가 아니므로 진단은 실제 클라이언트 TLS 소켓의 `encrypted`와 `authorized`를 확인했다. 초기 실패와 진단 수정 기록은 삭제하지 않고 비공개 준비 증거에 보존했다. DB/Storage 자격증명 확인을 제품 통합 수용 PASS로 사용하지 않는다.

## 구현·실행 순서

1. 사용자: 연결 값을 비추적 `.env`에 준비하고 `설정 완료`라고 알린다. 신규/기존 프로젝트 여부만 함께 알린다. Supabase 계정 토큰이나 GitHub 토큰을 채팅으로 보낼 필요는 없다.
2. Goal: 새 adapter/async transaction/PostgreSQL migration/Storage upload-finalize·읽기/공유 세션을 구현하고 독립 검증한다. 이때 앱 전용 namespace와 합성 fixture만 사용한다.
3. Goal: 별도 테스트 schema와 Storage prefix에서 migration 반복·seed 보존·두 인스턴스·권한·동시성·첨부/Excel/OCR·AI 결과를 검증한다. Supabase 사용자 데이터를 비우거나 기존 SQLite를 삭제하지 않는다.
4. Vercel: 구현된 코드와 맞는 서버 환경변수를 해당 Production/Preview 환경에 설정한다. `DATABASE_URL`, `SUPABASE_SECRET_KEY`에는 `NEXT_PUBLIC_`를 붙이지 않는다. `DIRECT_URL`은 migration 실행 환경에만 필요하며 runtime에 꼭 제공할 필요가 없다.
5. 변경 커밋 push와 기존 Git 연동 배포 후 실제 배포 주소에서 로그인·업무·상품·첨부·다른 브라우저/인스턴스·영속성·AI를 확인한다. 환경변수 변경은 새 배포에 적용된다. 배포 보호 때문에 접근할 수 없으면 보호를 임의 해제하지 않고 정확한 blocker를 보고한다.

APP_ORIGIN은 사용자가 `https://g-30-pi.vercel.app`로 등록했다고 확인했다. 원격 값 자체를 에이전트가 읽어 검증한 것은 아니다. 현재 외부 비로그인 진단은 Vercel 로그인으로 이동하고 `/api/health`가 배포 보호 401을 반환했다. 이것을 DB 장애 또는 연결 성공으로 판정하지 않는다.

## 관련 공식 문서

[서버리스 연결과 DATABASE_URL](https://supabase.com/docs/guides/database/postgres-js), [API key 종류](https://supabase.com/docs/guides/getting-started/api-keys), [Vercel Marketplace 연결](https://supabase.com/docs/guides/integrations/vercel-marketplace).
