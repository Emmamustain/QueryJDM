import { type NextRequest } from "next/server";
import relationsData from "@/lib/relations_dict.json";

type Variable = {
  name: string;
  values: string[];
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query") ?? "";
  const query_parts: string[] = query.split(" ");

  // Find all variables (single uppercase letters only)
  const variables: Variable[] = Array.from(
    new Set(query_parts.filter((part) => /^[A-Z]$/.test(part)))
  ).map((name) => ({
    name,
    values: [],
  }));

  // Track concatenated variable names to validate them later
  const validConcatVars = new Set<string>();

  //   const logs: any[] = [];

  console.log("Initial query_parts:", query_parts);
  console.log("Initial variables:", variables);

  // First pass: Process initial relations to populate variables
  for (let i = 0; i < query_parts.length; i++) {
    const part = query_parts[i];
    if (part.startsWith("z_LORSQUE")) {
      break;
    }
    if (part.startsWith("r_")) {
      console.log(`Processing r_ relation at index ${i}:`, {
        part,
        prevOne: query_parts[i - 1],
        next: query_parts[i + 1],
      });

      // Look at position before r_ for the variable
      const variable = variables.find((v) => v.name === query_parts[i - 1]);
      console.log("Found variable for r_ relation:", variable);

      if (variable) {
        const actionId = relationsData.relations.find(
          (v) => v.code === part
        )?.id;
        const wordAfterAction = query_parts[i + 1];

        console.log("Fetching relations for:", {
          actionId,
          wordAfterAction,
          variable: variable.name,
        });

        const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${wordAfterAction}?types_ids=${actionId}&min_weight=50&limit=500`;

        const res = await fetch(apiUrl, {
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        variable.values = data.nodes.flatMap((v: { name: string }) => v.name);
        console.log(
          `Populated variable ${variable.name} with ${variable.values.length} values`
        );
      }
    }
  }

  console.log(
    "After first pass - variables:",
    variables.map((v) => ({
      name: v.name,
      valueCount: v.values.length,
    }))
  );

  // Second pass: Process x_ET and x_OU operations
  for (let i = 0; i < query_parts.length; i++) {
    const part = query_parts[i];
    if (part === "x_ET" || part === "x_OU") {
      // Look for the last populated variable before x_ET
      let prevVarIndex = i - 1;
      while (prevVarIndex >= 0) {
        const prevVar = variables.find(
          (v) => v.name === query_parts[prevVarIndex]
        );
        if (prevVar) {
          const nextVarName = query_parts[i + 1];
          const nextVar = variables.find((v) => v.name === nextVarName);

          console.log(`Processing ${part} operation:`, {
            prevVar: prevVar.name,
            nextVar: nextVar?.name,
          });

          if (nextVar) {
            let newValues: string[] = [];
            if (part === "x_ET") {
              newValues = prevVar.values.filter((value) =>
                nextVar.values.includes(value)
              );
            } else {
              // x_OU
              newValues = [...new Set([...prevVar.values, ...nextVar.values])];
            }

            const newVarName = prevVar.name + nextVar.name;
            console.log("Creating concatenated variable:", {
              name: newVarName,
              valueCount: newValues.length,
            });

            variables.push({
              name: newVarName,
              values: newValues,
            });
            validConcatVars.add(newVarName);

            query_parts[i + 1] = newVarName;

            console.log("Updated query_parts:", query_parts);
            console.log(
              "Current variables:",
              variables.map((v) => ({
                name: v.name,
                valueCount: v.values.length,
              }))
            );
          }
          break;
        }
        prevVarIndex--;
      }
    }
  }

  console.log(
    "After second pass - variables:",
    variables.map((v) => ({
      name: v.name,
      valueCount: v.values.length,
    }))
  );

  // Third pass: Process z_LORSQUE conditions
  for (let i = 0; i < query_parts.length; i++) {
    const part = query_parts[i];
    if (part === "z_LORSQUE" || part === "z_LORSQUE-1") {
      const sourceVarName = query_parts[i + 1];
      console.log("Processing z_LORSQUE:", {
        type: part,
        sourceVarName,
        queryParts: query_parts,
      });

      const sourceVar = variables.find((v) => v.name === sourceVarName);
      console.log("Found source variable:", {
        name: sourceVar?.name,
        valueCount: sourceVar?.values.length,
      });

      if (sourceVar) {
        console.log("Source variable values count:", sourceVar.values.length);
        const relationCode = query_parts[i + 2];
        const targetValue = query_parts[i + 3];
        const relationId = relationsData.relations.find(
          (v) => v.code === relationCode
        )?.id;

        if (relationId) {
          const filteredValues: string[] = [];

          for (const result of sourceVar.values) {
            const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${result}/to/${targetValue}`;
            const res = await fetch(apiUrl, {
              headers: { "Content-Type": "application/json" },
            });
            const relationData = await res.json();

            try {
              const hasRelation = relationData.relations.some(
                (rel: { type: number; w: number }) =>
                  rel.type === relationId && rel.w > 0
              );

              if (
                (part === "z_LORSQUE" && hasRelation) ||
                (part === "z_LORSQUE-1" && !hasRelation)
              ) {
                filteredValues.push(result);
              }
            } catch (error) {
              console.error("Error processing relation data:", error);
              continue;
            }
          }

          sourceVar.values = filteredValues;
        }
      }
    }
  }

  console.log(
    "Final variables:",
    variables.map((v) => ({
      name: v.name,
      valueCount: v.values.length,
    }))
  );

  // Return results for all variables
  const results = Object.fromEntries(
    variables
      .sort((a, b) => a.name.length - b.name.length) // Sort by name length to show single variables first
      .map((v) => [v.name, v.values])
  );

  return Response.json({ results, query });
}
