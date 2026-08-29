"use client";

import { useEffect } from "react";
import { defaultProfileId } from "@/lib/profiles";

import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { ProfileProvider, useProfile, getActiveProfileId } from "@/app/runtime/profile-context";
import { WorkspaceProvider, useWorkspace, getActiveWorkspace } from "@/app/runtime/workspace-context";
import { ReasoningProvider, getReasoningMode } from "@/app/runtime/reasoning-context";
import { WebSearchProvider, getWebSearchEnabled } from "@/app/runtime/websearch-context";
import { ModelProvider, getActiveModelId } from "@/app/runtime/model-context";
import { threadListAdapter } from "@/app/runtime/thread-adapter";
import { ProfileSelector } from "@/components/profile-selector";
import { WorkspaceSelector } from "@/components/workspace-selector";
import { ModelSelector } from "@/components/model-selector";
import { DescribeDataToolUI, SqlQueryToolUI } from "@/components/tool-uis/sql-tool";
import { SqlApprovalTool } from "@/components/tool-uis/sql-approval";
import { WriteApprovalTool } from "@/components/tool-uis/write-approval";
import { SetOrderStatusToolUI, RecordPaymentToolUI } from "@/components/tool-uis/write-tool";
import { ReportInjectionTool } from "@/components/tool-uis/report-injection";
import {
  UserTimelineToolUI,
  TransferSessionsToolUI,
  AfterHoursToolUI,
  OutliersToolUI,
} from "@/components/tool-uis/chart-tool";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { AuditLog } from "@/components/audit-log";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

const securityConfig = AuiConfig({
  suggestions: Suggestions([
    "Décris les données disponibles",
    "Pot de miel IBM i (HONEYPOT) : distingue le bruit de fond des attaques réellement ciblées, et identifie la menace la plus crédible pour ce serveur. Justifie par les chiffres.",
    "Sur le pot de miel, quels profils réels ont été visés et depuis quelles adresses (internes vs externes) ?",
    "Y a-t-il des usurpations de profil (PS) dans SECAUDIT.QAUDJRN_PROFILE_SWAP ?",
  ]),
});

const gestionConfig = AuiConfig({
  suggestions: Suggestions([
    "Décris les données de gestion disponibles",
    "Chiffre d'affaires mensuel 2017 et tendance",
    "Top 10 des catégories par chiffre d'affaires, avec panier moyen",
    "Quelles commandes sont bloquées en statut processing depuis le plus longtemps ?",
  ]),
});

const WORKSPACE_TITLES = {
  security: "Enquête sécurité — démo IBM i",
  gestion: "Gestion commerciale — démo IBM i",
} as const;

const Welcome = () => {
  const { workspace } = useWorkspace();
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        {WORKSPACE_TITLES[workspace]}
      </h1>
      <p className="text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both mt-2 text-sm duration-200">
        {workspace === "gestion"
          ? "Interrogez la base de gestion Db2 ou choisissez une suggestion ci-dessous."
          : "Posez une question sur les journaux d'activité ou choisissez une suggestion ci-dessous."}
      </p>
    </div>
  );
};

// Runtime + UI. Isolé pour être remonté au changement de profil (via `key`),
// ce qui rappelle `list()` avec le nouveau header et recharge la liste de
// threads cloisonnée (D7). Le header du transport et l'adapter de threads lisent
// le profil actif de manière SYNCHRONE depuis le singleton `getActiveProfileId`.
const AssistantRuntime = () => {
  const { workspace } = useWorkspace();
  const config = workspace === "gestion" ? gestionConfig : securityConfig;
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
        transport: new AssistantChatTransport({
          api: "/api/chat",
          // Lecture SYNCHRONE des singletons : le niveau de réflexion suit sans
          // remonter le runtime (contrairement au profil, via la `key`).
          headers: () => ({
            "x-demo-workspace": getActiveWorkspace(),
            "x-demo-profile": getActiveProfileId(),
            "x-demo-thinking": getReasoningMode(),
            "x-demo-model": getActiveModelId(),
            "x-demo-websearch": getWebSearchEnabled() ? "on" : "off",
          }),
        }),
      }),
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <SqlApprovalTool />
      <WriteApprovalTool />
      <ReportInjectionTool />
      <SqlQueryToolUI />
      <SetOrderStatusToolUI />
      <RecordPaymentToolUI />
      <DescribeDataToolUI />
      <UserTimelineToolUI />
      <TransferSessionsToolUI />
      <AfterHoursToolUI />
      <OutliersToolUI />
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <ThreadListSidebar />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>
                      {WORKSPACE_TITLES[workspace]}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto flex items-center gap-2">
                <WorkspaceSelector />
                <ModelSelector />
                <ProfileSelector />
                <AuditLog />
              </div>
            </header>
            <div className="flex-1 overflow-hidden">
              <Thread components={{ Welcome }} />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AssistantRuntimeProvider>
  );
};

// Remonte tout le runtime quand le profil change : `list()` est rappelé avec le
// nouveau header `x-demo-profile`, donc la liste de threads bascule.
const AssistantWithProfile = () => {
  const { profile, setProfile } = useProfile();
  const { workspace } = useWorkspace();
  // Cohérence workspace/profil (ex. localStorage divergent après mise à jour) :
  // un profil hors workspace bascule sur le défaut du workspace actif.
  useEffect(() => {
    if (profile.workspace !== workspace) setProfile(defaultProfileId(workspace));
  }, [profile, workspace, setProfile]);
  if (profile.workspace !== workspace) return null;
  return <AssistantRuntime key={`${workspace}:${profile.id}`} />;
};

export const Assistant = () => {
  return (
    <ModelProvider>
      <ReasoningProvider>
        <WebSearchProvider>
          <WorkspaceProvider>
            <ProfileProvider>
              <AssistantWithProfile />
            </ProfileProvider>
          </WorkspaceProvider>
        </WebSearchProvider>
      </ReasoningProvider>
    </ModelProvider>
  );
};
