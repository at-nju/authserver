import type { Env } from "./env";

export interface UserProps {
  userId: string;
  name: string;
}

export const userInfoHandler = {
  async fetch(_request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const { userId, name } = (ctx as ExecutionContext & { props: UserProps }).props;
    return Response.json({ sub: userId, name });
  },
};
