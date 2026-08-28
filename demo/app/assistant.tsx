"use client";

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
import { ReasoningProvider, getReasoningMode } from "@/app/runtime/reasoning-context";
import { WebSearchProvider, getWebSearchEnabled } from "@/app/runtime/websearch-context";
import { ModelProvider, getActiveModelId } from "@/app/runtime/model-context";
import { threadListAdapter } from "@/app/runtime/thread-adapter";
import { ProfileSelector } from "@/components/profile-selector";
import { ModelSelector } from "@/components/model-selector";
import { DescribeDataToolUI } from "@/components/tool-uis/sql-tool";
import { SqlApprovalTool } from "@/components/tool-uis/sql-approval";
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

const config = AuiConfig({
  suggestions: Suggestions([
    "Décris les données disponibles",
    "Pot de miel IBM i (HONEYPOT) : distingue le bruit de fond des attaques réellement ciblées, et identifie la menace la plus crédible pour ce serveur. Justifie par les chiffres.",
    "Sur le pot de miel, quels profils réels ont été visés et depuis quelles adresses (internes vs externes) ?",
    "Y a-t-il des usurpations de profil (PS) dans SECAUDIT.QAUDJRN_PROFILE_SWAP ?",
  ]),
});

const Welcome = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        Enquête sécurité — démo IBM i
      </h1>
      <p className="text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both mt-2 text-sm duration-200">
        Posez une question sur les journaux d&apos;activité ou choisissez une
        suggestion ci-dessous.
      </p>
    </div>
  );
};

// Runtime + UI. Isolé pour être remonté au changement de profil (via `key`),
// ce qui rappelle `list()` avec le nouveau header et recharge la liste de
// threads cloisonnée (D7). Le header du transport et l'adapter de threads lisent
// le profil actif de manière SYNCHRONE depuis le singleton `getActiveProfileId`.
const AssistantRuntime = () => {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
        transport: new AssistantChatTransport({
          api: "/api/chat",
          // Lecture SYNCHRONE des singletons : le niveau de réflexion suit sans
          // remonter le runtime (contrairement au profil, via la `key`).
          headers: () => ({
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
      <ReportInjectionTool />
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
                      Enquête sécurité — démo IBM i
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto flex items-center gap-2">
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
  const { profile } = useProfile();
  return <AssistantRuntime key={profile.id} />;
};

export const Assistant = () => {
  return (
    <ModelProvider>
      <ReasoningProvider>
        <WebSearchProvider>
          <ProfileProvider>
            <AssistantWithProfile />
          </ProfileProvider>
        </WebSearchProvider>
      </ReasoningProvider>
    </ModelProvider>
  );
};
