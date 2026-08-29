import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/chat": ["./agent-skills/**/SKILL.md"],
  },
};

export default withAui(nextConfig);
