import { InvitationForm } from "@/features/auth/forms";
export const metadata = { title: "초대 수락", referrer: "no-referrer" as const };
export default function Invitations() { return <section className="auth-panel panel"><p className="eyebrow">GS HALE · INVITATION</p><h1>초대 수락</h1><InvitationForm /></section>; }
