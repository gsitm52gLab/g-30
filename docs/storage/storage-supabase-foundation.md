# Supabase private Storage foundation

이 후보는 서버 Storage transport만 제공한다. 앱 라우트, shared DB upload receipt, 권한 재검사, Vercel 브라우저 흐름과 연결하기 전 **SB-07/08/09 전체 수용을 주장하지 않는다**. 기존 파일 구현을 교체하거나 지원 형식/25MiB·10개 한도를 줄이지 않았다.

## 사용 계약

`src/server/storage/supabase.ts`는 `server-only`이며 생성자에 서버 설정을 주입한다. 원격 Storage 실패를 로컬 파일/mock으로 대체하지 않는다. project origin 외에 Supabase 대시보드의 알려진 `/rest/v1[/]`, `/storage/v1[/]` suffix만 origin으로 정규화한다. 다른 host/path/query/자격증명 포함 URL은 거부한다. URL과 secret은 private class field에 보관하고 오류에 원격 응답·URL·키를 넣지 않는다.

| 메서드 | 계약 |
| --- | --- |
| `ensurePrivateBucket()` | 명시적 준비 작업이다. 부재 확인 후 private·25MiB bucket만 생성한다. 기존 버킷의 공개 여부·크기·MIME 제한이 다르면 변경하지 않고 실패한다. runtime GET에서 호출하지 않는다. |
| `allocateStagingKey()`, `allocateFinalKey()` | 서버 namespace 아래 각각 별도 UUID v4 경로를 생성한다. 파일명/사용자 입력을 경로로 쓰지 않는다. |
| `issueUploadGrant({key, expectedBytes, appExpiresAt})` | staging 경로만 서명한다. 서버에서 현재 권한 확인과 shared DB 허가 행을 먼저 준비한다. 반환 DTO의 signed URL/token은 해당 업로드용 비밀 capability이므로 로그에 남기지 않는다. 서버 key는 DTO에 없다. |
| `inspect(key)`, `readSnapshot(key)` | id/version/ETag/크기 검사와 bounded bytes, SHA-256을 제공한다. 다운로드 전후 metadata가 바뀌면 실패한다. |
| `promoteVerified({stagingKey, finalKey, originalName, declaredMime, expectedBytes})` | 최종 key를 pending DB receipt에 먼저 기록해야 한다. 실제 bytes·크기·signature를 기존 `validateFile`로 검사하고, 검사한 snapshot을 별도 final key에 create-only 업로드한 뒤 다시 SHA-256/크기를 검사한다. mutable source path를 늦게 복사하는 TOCTOU를 피한다. 서버 업로드 body는 Storage로 직접 나가는 요청이며 브라우저가 Vercel로 대용량 body를 보내는 방식이 아니다. |
| `readRange(object, start, end)` | 고정 metadata의 final object에서 최대 4MiB만 반환한다. 전후 version/ETag/크기와 HTTP 206, Content-Range 및 실제 바이트 수를 확인한다. signed download URL을 만들지 않는다. 각 chunk 요청 전후 현재 앱 ACL을 확인할 책임은 호출자에게 있다. |
| `cleanupExpiredStaging(object, safeCleanupAfter)` | shared DB의 배타적 cleanup claim을 얻은 호출자만 사용한다. staging/기한/현재 version을 검사한 뒤 exact-version DELETE를 보낸다. 서버가 versioned DELETE를 지원하지 않으면 안전하지 않은 path-only DELETE로 fallback하지 않는다. final key 삭제 기능은 제공하지 않는다. |

`VerifiedObject`의 key/id/version/bytes/etag/sha256/originalName/mime/preview를 DB에 고정한다. 키나 descriptor를 브라우저가 지정한 값으로 바꾸면 안 된다. 권한 철회·요청 버전 충돌·중복 finalize·복구/고아 상태는 공유 DB의 책임이다. finalize 시작 전과 최종 레코드 commit 직전 현재 actor/context/요청 version을 재검사한다. DB와 Storage를 하나의 transaction으로 부르지 않는다.

## 실제 signed token의 제한

Supabase 표준 업로드 token은 경로와 `upsert=false`, provider 만료에 묶여 있다. **개별 요청의 expectedBytes나 앱의 15분 만료·일회성을 Storage가 강제한다고 주장하지 않는다.** 실제 프로젝트에서 provider TTL은 약 2시간이었다. 버킷의 25MiB 상한은 별도로 강제하며 expectedBytes와 앱 기한은 shared DB finalize에서 검사한다.

직접 표준 업로드는 `PUT signedUrl`, 재개 업로드는 반환한 **`/storage/v1/upload/resumable/sign`** endpoint에 `x-signature: token`을 사용한다. TUS chunk는 공식 문서에 따라 6MiB다. 일반 `/upload/resumable`는 앱의 별도 Supabase Auth 사용자 JWT를 요구하므로 이 플랫폼의 custom auth + signed capability 방식과 맞지 않는다. secret key를 브라우저에 넘겨 우회하지 않는다.

실제 probe에서 동일 경로가 존재할 때 signed PUT 재사용과 임의 `x-upsert:true`는 거부됐다. 하지만 staging을 삭제하면 아직 유효한 token으로 **다시 생성할 수 있었다**. 그래서 finalize 후 staging을 즉시 삭제하지 않으며, 업로드 capability를 final key에 발급하지 않는다. `safeCleanupAfter`는 발급 후 24시간의 TUS 가능 기간과 provider 만료 중 늦은 시각 + 5분이다. 이 값과 upload receipt를 DB에 보존하고, cleanup과 finalize claim은 상호 배타적이어야 한다. 이 transport만으로 distributed lock이 있다고 주장하지 않는다.

원격 mutation은 자동 재시도하지 않는다. 네트워크 timeout/5xx/응답 파싱 실패는 `outcome: unknown`으로 반환하므로 같은 final key의 실제 상태·hash를 조회하여 pending receipt를 복구한다. 결과를 모른 채 새 final key를 계속 만들거나 final object를 삭제하지 않는다. 읽기 재시도는 기본 1회(최대 2회), 요청 전체 timeout 기본 30초(최대 120초), 한 인스턴스 동시 요청 기본 4개(최대 16개)다. 이는 기술적 로컬 backpressure이며 다중 인스턴스 rate limit은 별도다.

## 검증 실행

```sh
npm exec vitest run tests/unit/storage-supabase.test.ts
STORAGE_PROBE_ENV_FILE=/absolute/private/project/.env \
STORAGE_PROBE_EVIDENCE_DIR=/absolute/private/evidence \
node --conditions=react-server --import tsx scripts/verify-storage-supabase.ts
```

실제 probe는 `sb_storage_foundation_20260922` namespace에 현재 실행에서 생성한 UUID key와 합성 bytes만 사용한다. 버킷은 보존하고 정확히 해당 실행 소유 key만 정리한다. 외부 객체/정책/원본 자료를 삭제하지 않는다. 출력은 통계와 증거 경로뿐이며 key/token/원격 body를 출력하지 않는다. 생성한 JSON은 실제 cwd·원격 결과·PASS/FAIL/NOT_RUN 수를 기록한다. 일부 cleanup API 검증은 테스트 전용 가상 시각을 사용하므로 실제 24시간 만료를 기다린 증거가 아니다. 이 script는 명시적 원격 테스트 명령이며 일반 unit test에서 실행되지 않는다.

### 동일 내용·새 버전 검증의 전제

동일 bytes를 privileged upsert해도 실제 Storage id/version이 유지될 수 있다. 이전 후보의 이 probe는 독립 실행에서 6 PASS / 1 FAIL이었으며, 새 실행에서 7 PASS여도 이전 실패를 취소하지 않는다. 따라서 이 검사에서는 현재 실행 소유 final key의 정확한 version을 삭제하고, object-not-found 응답을 확인한 뒤 동일 bytes로 다시 생성한다. 실제 id와 version이 모두 달라지고 SHA-256·ETag·크기·bytes는 같다는 전제를 먼저 검사한 다음 이전 descriptor의 Range가 `INTEGRITY`로 거부되는지 확인한다. 임의 오류를 부재로 간주하지 않는다. 이 삭제·재생성은 합성 fixture 준비에만 존재하며 제품 transport의 final 삭제 기능을 추가하지 않는다.

## 공식 참고

- [Supabase signed upload API](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Supabase 재개 업로드·6MiB chunk·signed token](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Storage signed TUS route 및 lifecycle](https://github.com/supabase/storage/blob/master/src/http/routes/tus/lifecycle.ts)
- [Storage upload signature와 upsert 검사](https://github.com/supabase/storage/blob/master/src/http/routes/object/uploadSignedObject.ts)
- [Storage exact-version delete](https://github.com/supabase/storage/blob/master/src/http/routes/object/deleteObjects.ts)
- [Storage metadata의 id/version/etag](https://github.com/supabase/storage/blob/master/src/storage/renderer/info.ts)

문서/소스 열람일: 2026-09-22. upstream master 소스는 배포 버전 보장이 아니므로 실제 API probe 결과를 함께 확인한다. Next.js 설치본의 `node_modules/next/dist/docs/01-app/02-guides/data-security.md`를 읽고 서버 전용 transport와 최소 DTO 원칙을 적용했다.

## 후보 구현자 실행 결과 (독립 검증 전)

이 worktree에서 추가 단위 검사 38개와 전체 unit 회귀 707개가 통과했다. ESLint/TypeScript 검사도 통과했다. 실제 Storage 첫 시도는 13 PASS / 1 FAIL / 1 NOT_RUN으로 TUS endpoint 오류를 남겼다. 수정 후 실제 일반 probe는 15 PASS / 0 FAIL, 추가 adversarial probe는 7 PASS / 0 FAIL이었다. 실패 증거도 삭제하지 않았다.

실제 25MiB는 TUS 5 chunk로 올리고 6MiB 진행 시 HEAD offset을 읽은 다음 재개했다. 확정 파일을 4MiB 이하 Range 7개로 다시 읽은 SHA-256이 같았다. 25MiB+1 TUS 생성은 HTTP 413, 먼저 발급된 늦은 TUS 완료는 HTTP 409, token의 final 경로 대입은 HTTP 400이었다. 합성 staging 교체 중 snapshot 검증과 동일 bytes·새 final version에 대한 이전 Range descriptor는 거부됐으며, exact old-version DELETE는 동시 생성된 새 version을 보존했다. 현재 실행 소유 객체와 미완료 TUS 리소스는 정리하고 버킷은 보존했다.

실제 브라우저 CORS/업무 권한/가격 비노출/DB receipt/중복 finalize/shared cleanup claim/10개 UI 업로드/재시작/Vercel 배포 검증은 **NOT_RUN**이다. 앱 권한 검사는 transport 외부의 서버 서비스에 남아 있으며, 이 후보를 통합하는 단계에서 위 검증을 수행해야 한다. 구현자 실행 결과가 독립 검증이나 통합 수용을 대체하지 않는다.
