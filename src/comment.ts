import type { RepoContext } from "./context.js";
import { AxiError } from "./errors.js";
import { ghJson } from "./gh.js";

export interface CreatedComment {
  author?: { login: string };
  body?: string;
  createdAt?: string;
}

interface ApiComment {
  user?: { login?: string };
  body?: string;
  created_at?: string;
}

export async function fetchCreatedComment(
  output: string,
  ctx?: RepoContext,
): Promise<CreatedComment> {
  const matches = [...output.matchAll(/#issuecomment-(\d+)/g)];
  const id = matches.at(-1)?.[1];
  if (!id) {
    throw new AxiError(
      `Unexpected gh comment output: ${output.slice(0, 200)}`,
      "UNKNOWN",
    );
  }

  const repository = ctx
    ? `repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.name)}`
    : "repos/{owner}/{repo}";
  const comment = await ghJson<ApiComment>([
    "api",
    `${repository}/issues/comments/${id}`,
  ]);

  return {
    ...(comment.user?.login
      ? { author: { login: comment.user.login } }
      : {}),
    ...(comment.body !== undefined ? { body: comment.body } : {}),
    ...(comment.created_at !== undefined
      ? { createdAt: comment.created_at }
      : {}),
  };
}
