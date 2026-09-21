import { blankContent, blankRequirement } from "./types";
import type { RecordInput } from "../records";
export const builtins: RecordInput<"templateVersion">[] = [
    ["documents", "상품 등록/서류", "상품과 요청 서류를 준비해 주세요."],
    ["pop", "POP·리플렛", "일본어 문안과 확인용 제작물을 준비해 주세요."],
    ["brandpage", "브랜드페이지 자료", "외부 리테일러 브랜드페이지에 사용할 자료를 준비해 주세요."],
    ["video", "영상/교육", "영상의 제작 주체와 자막·원본 제공 책임을 확인해 주세요."],
    ["campaign", "행사 참여", "행사 참여 의사와 선택 메뉴의 조건을 확인해 주세요."],
    ["samples", "샘플·실물 배송", "목적지·용도별 실물 준비 내용을 확인해 주세요."],
    ["updates", "정기 업데이트", "이번 회차와 대상 기간의 변경 내용을 작성해 주세요."],
].map(([key, name, description]) => ({ id: `builtin-${key}-v1`, contextId: null, data: {
    templateId: `builtin-${key}`, name, sequence: 1, previousId: null, createdBy: "system", builtin: true,
    content: { ...blankContent(), title: name, description, output: name,
        requirements: [{ ...blankRequirement(`${key}-response`, key === "samples" ? "physical_record" : "long_text"), label: name === "행사 참여" ? "참여 관련 설명" : "요청 내용 답변" }] },
} }));
