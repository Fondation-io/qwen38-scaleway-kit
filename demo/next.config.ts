import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/chat": ["./agent-skills/**/SKILL.md"],
  },
};

export default withAui(nextConfig);
