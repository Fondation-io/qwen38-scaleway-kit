"use client";

import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import {
  SqlQueryToolUI,
  DescribeDataToolUI,
} from "@/components/tool-uis/sql-tool";
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
    "Quels profils portent une autorité spéciale (*ALLOBJ, *SECADM) ?",
    "Montre les sessions de transfert du profil AAM0658 en octobre-novembre 2010",
    "Y a-t-il des usurpations de profil (événement PS) dans les journaux ?",
  ]),
});

const Welcome = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        Enquête sécurité — démo Qwen3.8-27B
      </h1>
      <p className="text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both mt-2 text-sm duration-200">
        Posez une question sur les journaux d&apos;activité ou choisissez une
        suggestion ci-dessous.
      </p>
    </div>
  );
};

export const Assistant = () => {
  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <SqlQueryToolUI />
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
                      Enquête sécurité — démo Qwen3.8-27B
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
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
