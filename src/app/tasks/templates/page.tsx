import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContextBar,StorageFailure } from "@/components/workspace";
import { workspaceFailure,type Search } from "@/server/workspace";
import { catalogPage } from "@/features/tasks/server";
import { Templates } from "@/features/tasks/templates";
export const metadata:Metadata={title:"요청 템플릿"};export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Search}){const d=await catalogPage(searchParams).catch(workspaceFailure);if(!d)return <StorageFailure/>;if(!d.catalog?.canManage||!d.workspace.selected)notFound();return <><ContextBar workspace={d.workspace}/><Templates key={d.workspace.selected.id} initial={d.catalog} contextId={d.workspace.selected.id}/></>;}
