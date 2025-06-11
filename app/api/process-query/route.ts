import { type NextRequest } from "next/server";
import { createQueryEngine } from "@/utils/parseQuery";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query") ?? "";

  const { parseQuery, executeQuery, astToString } = createQueryEngine();
  try {
    const parsedQuery = parseQuery(query);
    console.log({ parsedQuery: JSON.stringify(parsedQuery) });
    const { result, variables } = await executeQuery(parsedQuery);

    return Response.json({
      ast: astToString(parsedQuery),
      variables: variables,
      result,
      query,
    });
  } catch (e) {
    return Response.json({
      error: (e as Error).message,
      variables: [],
      result: {},
      query,
    });
  }
}
