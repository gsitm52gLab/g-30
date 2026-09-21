from pathlib import Path
import json,re,hashlib
p=Path(__file__).parent
prd=(p/'01-detailed-prd.md').read_text()
goal=(p/'02-goal-matrix.md').read_text()
workflow=(p/'03-agent-workflow.md').read_text()
deps={0:[],1:[0],2:[1],3:[7,8,9,11,12,13,14],4:[2],5:[4],6:[2,4],7:[5,6],8:[4,5],9:[4,5],10:[5],11:[5,6,9,10],12:[4,5,6],13:[8,9,10,11,12],14:[7,8,9,10,11,12,13],15:[5,6],16:[15],17:[16],18:list(range(18))}
headings=re.findall(r'^## PRD-(\d{2}) (.+)$',prd,re.M)
assert len(headings)==19
acs=re.findall(r'^- \*\*(AC-\d{2}-\d{2}):\*\* (.+)$',prd,re.M)
assert len(acs)==len(set(x[0] for x in acs))==91
tasks=[]
for n,title in headings:
 i=int(n);task={'id':f'G{n}','prd_id':f'PRD-{n}','title':title,'dependencies':[f'G{x:02d}' for x in deps[i]],'state':'PLANNED','required_for_product_completion':True,'candidate_commit':None,'integration_commit':None,'implementer_session_id':None,'verifier_session_id':None,'attempt':0,'owned_paths':[],'actual_worktree_cwd':None,'evidence_root':f'.execution/private/runs/<run-id>/G{n}/<attempt>/','acceptance':[{'id':a,'expected':b,'status':'NOT_RUN','evidence':[]} for a,b in acs if a.startswith(f'AC-{n}-')],'next_action':'DoR와 실제 선행 ACCEPTED 증거 확인 후 구현 패킷 발행'}
 tasks.append(task)
visited=set();active=set()
def visit(n):
 assert n not in active,'dependency cycle'
 if n in visited:return
 active.add(n)
 for x in deps[n]:visit(x)
 active.remove(n);visited.add(n)
for n in deps:visit(n)
plan={'schema_version':1,'product':'GS HALE','project_root':'/Users/evan/workspace/gs-hale','source_revision':'DP-20260921-03','plan_status':'DRAFT_NOT_STARTED','active_goal_count':0,'intended_active_goal_count':1,'runtime_state_path':'.execution/run-plan.json','max_sessions_including_main':4,'initial_git':'reinitialized by user; main unborn; origin exists; recheck on execution','tasks':tasks,'mandatory_external_integration':['OpenAI: synthetic or permitted public input, actual response/schema/grounding contract/usage evidence'],'operational_unverified_allowed':['actual business Excel compatibility','actual external email delivery','expert legal validation','production backup restore'],'completion_policy':'all required task states ACCEPTED, independent verification and integrated regression evidence; no silent scope deletion','secret_policy':'env runtime only; no values in packets/logs/Git'}
(p/'04-run-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
baseline=Path('/Users/evan/Documents/Codex/2026-09-21/cj/outputs/리테일_운영플랫폼_최종통합_상세기획_v3_검토용.md')
(p/'source-planning-v3.md').write_text(baseline.read_text())
readme='''# GS HALE 실행 문서 v1

상태: 문서 작성 완료 / 제품 Goal 미실행. 지정 프로젝트는 `/Users/evan/workspace/gs-hale`.

1. [실행 계약·환경·권한](00-execution-contract.md)
2. [상세 PRD 19개·수용 조건 91개](01-detailed-prd.md)
3. [G00~G18 Goal 조건·A01~A26 대응](02-goal-matrix.md)
4. [서브세션 구현·독립 검증·보완·재개](03-agent-workflow.md)
5. [기계 판독 실행 계획](04-run-plan.json)
6. [최종 /goal 프롬프트](05-goal-prompt.md)
7. [기획 v3 로컬 보존본](source-planning-v3.md)

단일 Goal 내부의 19개 체크포인트다. 모든 상태는 PLANNED/NOT_RUN이며 이번 문서 작성의 검증을 제품 테스트 통과로 해석하지 않는다. 구현 시작 때 04 계획을 `.execution/run-plan.json`에 초기화하고 이후 상태를 관리한다. 비공개 실행 증거는 `.execution/private/runs/<run-id>/<Gxx>/<attempt>/`에 저장한다.

검토: 3개 작성 서브세션 및 교차 문서 감사. 초기 검증의 순환, AI 실호출 필수 조건, worktree cwd 불일치를 발견해 수정했다. Git 재초기화 이후 상태 재확인, .env 원본 보존 및 추적 제외. 새 페이지 게시 후 링크/보존 검증은 publication-verification.json에 기록한다.
'''
(p/'README.md').write_text(readme)
# Assemble one reviewable Notion document, with the complete /goal prompt last.
intro='<callout icon="📘" color="blue_bg">\n\tGS HALE 실행 명세 v1 · 검토용. PRD 19개 / AC 91개 / G00~G18 / 독립 서브세션 검증·보완·재개. 제품 Goal은 아직 실행하지 않았다. 최신 Git 재초기화와 사용자 브랜드 문구를 반영했다.\n</callout>\n<table_of_contents/>\n'
names=['00-execution-contract.md','01-detailed-prd.md','02-goal-matrix.md','03-agent-workflow.md']
content=intro+'\n\n'.join((p/x).read_text() for x in names)
content+='\n\n# 실행 계획과 문서 감사\n\n로컬 `docs/execution-v1/04-run-plan.json`은 19개 작업과 91개 수용 조건, 선행 관계, 모든 미착수/미실행 상태, 증거 경로를 담는다. 실제 원장은 실행 시 `.execution/run-plan.json`으로 관리한다.\n\n문서 작성은 상세 PRD·Goal 매트릭스·워크플로우의 3개 서브세션으로 나눴고, 교차 검토에서 발견한 초기 단계의 순환 의존, AI 실호출 완료 조건 불일치, worktree cwd 혼동을 수정했다. 다음 그래프는 실행 순서를 표현하며 번호 순서대로만 구현한다는 의미가 아니다.\n'
content+='\n| 체크포인트 | 선행 ACCEPTED | 수용 조건 수 | 현재 상태 |\n| --- | --- | --- | --- |\n'
for t in tasks:content+=f"| {t['id']} {t['title']} | {', '.join(t['dependencies']) or '없음'} | {len(t['acceptance'])} | PLANNED / NOT_RUN |\n"
content+='\n아래 프롬프트가 이 문서의 마지막 실행 진입점이다. 기존 Notion 페이지는 수정하지 않았고, 새로운 실행 명세만 작성했다. 로컬 기획 보존본도 함께 저장했다.\n\n'+(p/'05-goal-prompt.md').read_text()
# Convert tables only outside fenced code.
lines=content.splitlines();out=[];i=0;fence=False;tables=0
while i<len(lines):
 line=lines[i]
 if line.startswith('```'):fence=not fence;out.append(line);i+=1;continue
 if not fence and line.startswith('| ') and i+1<len(lines) and re.fullmatch(r'[| :\-]+',lines[i+1]):
  rows=[]
  while i<len(lines) and lines[i].startswith('| '):
   if not re.fullmatch(r'[| :\-]+',lines[i]):rows.append([x.strip() for x in lines[i].strip().strip('|').split('|')])
   i+=1
  assert len(set(map(len,rows)))==1
  out.append('<table header-row="true">');out += ['<tr>'+''.join('<td>'+x+'</td>' for x in row)+'</tr>' for row in rows];out.append('</table>');tables+=1
 else:out.append(line);i+=1
result='\n'.join(out)
result=re.sub(r'\[최종 통합 기획 v3\]\(https://app.notion.com/p/3e2cee7d6a9b8131b8d1c1ef0dd49898\)',r'<mention-page url="https://app.notion.com/p/3e2cee7d6a9b8131b8d1c1ef0dd49898"/>',result)
(p/'notion-content.md').write_text(result)
assert not fence
assert all(f'G{x:02d}' in goal for x in range(19))
assert all(re.search(fr'^\| A{x:02d} \|',prd,re.M) for x in range(1,27))
assert result.rstrip().endswith('```')
secret_values=[]
for line in (p.parents[1]/'.env').read_text().splitlines():
 m=re.match(r'\s*(OPENAI_API_KEY)\s*=\s*(.+)',line)
 if m:secret_values.append(m[2].strip().strip('"\''))
for s in secret_values:
 if len(s)>12:assert s not in result,'secret exposure'
report={'document_check':'PASS','prd_modules':19,'acceptance_criteria':91,'goals':19,'original_A_coverage':26,'dependency_graph':'acyclic','tables':tables,'content_chars':len(result),'product_tests_run':False,'goal_activated':False,'cross_review_P1_fixed':3,'source_sha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'secret_values_present':False}
(p/'document-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
