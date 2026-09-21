import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContextBar,StorageFailure } from "@/components/workspace";
import { workspaceFailure,type Search } from "@/server/workspace";
import { catalogPage } from "@/features/tasks/server";
import { CreateTask } from "@/features/tasks/create";
export const metadata:Metadata={title:"업무 만들기"};export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Search}){const d=await catalogPage(searchParams).catch(workspaceFailure);if(!d)return <StorageFailure/>;if(!d.catalog?.canManage||!d.workspace.selected)notFound();return <><ContextBar workspace={d.workspace}/><CreateTask key={d.workspace.selected.id} catalog={d.catalog} contextId={d.workspace.selected.id} initialProjectId={typeof (await searchParams).project === "string" ? String((await searchParams).project) : ""}/></>;}
