import {SubmissionFile,type DisplayFile} from '@/features/submissions/views';
/** The correction file DTO may omit uploader metadata; omission is not a pending lookup. */
export function CorrectionFile({file}:{file:DisplayFile}){return <SubmissionFile file={{...file,uploaderLabel:file.uploaderLabel||'정보 미제공',uploadedAt:file.uploadedAt||'업로드 시각 미제공'}}/>;}
