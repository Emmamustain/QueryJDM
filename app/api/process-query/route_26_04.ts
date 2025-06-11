import { type NextRequest } from "next/server";
import relationsData from "@/lib/relations_dict.json";

const LIMIT = 900;
const MIN_WEIGHT = 30;

type Variable = {
  name: string;
  values: string[];
};

type QueryPart = {
  before: string;
  action: string;
  after: string;
};

type ResultPair = {
  x: string;
  y: string;
};

type Node = { id: number; name: string; type: number; w: number };

function parseConditionsAndOperators(queryParts: string[]) {
  const conditionsAndOperators = [];
  let i = 0;
  while (i < queryParts.length) {
    if (i + 2 >= queryParts.length) break;
    const condition = queryParts.slice(i, i + 3);
    let operator = null;
    i += 3;
    if (i < queryParts.length) {
      const op = queryParts[i];
      if (op === "ET" || op === "OU") {
        operator = op;
        i += 1;
      }
    }
    conditionsAndOperators.push({ condition, operator });
  }
  return conditionsAndOperators;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query") ?? "";
  const optimize = searchParams.get("optimize") === "true";

  const queryParts = query.replace(/[()]/g, " ").split(" ").filter(Boolean);
  const conditionsAndOperators = parseConditionsAndOperators(queryParts);

  const variables: Variable[] = Array.from(
    new Set(queryParts.filter((part) => part.startsWith("$")))
  ).map((name) => ({
    name,
    values: [],
  }));

  variables.push({
    name: "$result",
    values: [],
  });

  console.log("Initial queryParts:", queryParts);
  console.log("Parsed conditions and operators:", conditionsAndOperators);

  let previousVariables: string[] = [];
  let currentOperator: string | null = null;

  for (const { condition, operator } of conditionsAndOperators) {
    const [before, action, after] = condition;

    console.log("Processing condition:", { before, action, after });

    const actionId = relationsData.relations.find((v) => v.code === action)?.id;

    if (!actionId) {
      console.log("Action not found, skipping condition");
      continue;
    }

    let apiUrl: string | null = null;
    const variableNames: string[] = [];

    if (before.startsWith("$") && !after.startsWith("$")) {
      // Case: $x r_action word
      variableNames.push(before);
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/to/${after}?types_ids=${actionId}&min_weight=${MIN_WEIGHT}&limit=${LIMIT}`;
    } else if (!before.startsWith("$") && after.startsWith("$")) {
      // Case: word r_action $x
      variableNames.push(after);
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${before}?types_ids=${actionId}&min_weight=${MIN_WEIGHT}&limit=${LIMIT}`;
    } else if (!before.startsWith("$") && !after.startsWith("$")) {
      // Case: word1 r_action word2 (no variables to update)
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${before}/to/${after}?types_ids=${actionId}&min_weight=${MIN_WEIGHT}&limit=${LIMIT}`;
    } else if (before.startsWith("$") && after.startsWith("$")) {
      // Case: $x r_action $y (handled later)
      console.log("Skipping relation between two variables for now");
      continue;
    } else {
      console.log("Unhandled case, skipping condition");
      continue;
    }

    console.log("API URL:", apiUrl);

    let newValues: string[] = [];
    if (apiUrl) {
      try {
        const res = await fetch(apiUrl, {
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        // console.log(data);
        data.nodes = (data.nodes as Node[]).filter((value) => value.type === 1);
        newValues = data.nodes?.flatMap((v: { name: string }) => v.name) ?? [];
        console.log(`Fetched ${newValues.length} values for condition`);
      } catch (error) {
        console.error("API call failed:", error);
        continue;
      }
    }

    for (const varName of variableNames) {
      const variable = variables.find((v) => v.name === varName);
      if (!variable) {
        console.log(`Variable ${varName} not found`);
        continue;
      }

      console.log(
        `Updating variable ${varName} with new values (count: ${newValues.length}), current operator: ${currentOperator}`
      );

      if (currentOperator && previousVariables.includes(varName)) {
        console.log(
          `Combining with previous values using ${currentOperator}, previous count: ${variable.values.length}, new count: ${newValues.length}`
        );
        if (currentOperator === "ET") {
          variable.values = variable.values.filter((v) =>
            newValues.includes(v)
          );
        } else if (currentOperator === "OU") {
          const combined = [...new Set([...variable.values, ...newValues])];
          variable.values = combined;
        }
        console.log(`Result count after combining: ${variable.values.length}`);
      } else {
        variable.values = [...newValues];
        console.log(`Set variable ${varName} to new values`);
      }
    }

    previousVariables = variableNames;
    currentOperator = operator ?? null;
    console.log(
      `Updated previousVariables to ${previousVariables}, currentOperator to ${currentOperator}`
    );
  }

  // Second step: process relations between variables ($x r_action $y)
  const resultPairs: ResultPair[] = [];
  const resultVariable = variables.find((v) => v.name === "$result");

  for (let i = 0; i < queryParts.length - 2; i++) {
    const currentPart = queryParts[i];
    const nextPart = queryParts[i + 1];
    const afterNextPart = queryParts[i + 2];

    if (
      nextPart.startsWith("r_") &&
      currentPart.startsWith("$") &&
      afterNextPart.startsWith("$")
    ) {
      const xVar = variables.find((v) => v.name === currentPart);
      const yVar = variables.find((v) => v.name === afterNextPart);

      if (
        !xVar ||
        !yVar ||
        xVar.values.length === 0 ||
        yVar.values.length === 0
      ) {
        console.log("Skipping relation between variables due to empty values");
        continue;
      }

      const actionId = relationsData.relations.find(
        (v) => v.code === nextPart
      )?.id;

      if (!actionId) {
        console.log("Action not found, skipping");
        continue;
      }

      console.log(
        `Processing relation between variables ${currentPart} and ${afterNextPart} with action ${nextPart}`
      );

      for (const x of xVar.values) {
        try {
          const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${x}?types_ids=${actionId}&min_weight=${MIN_WEIGHT}&limit=${LIMIT}&type=1`;
          const res = await fetch(apiUrl, {
            headers: { "Content-Type": "application/json" },
          });
          const data = await res.json();

          if (data.nodes) {
            const validYValues = data.nodes
              .map((v: { name: string }) => v.name)
              .filter((y: string) => yVar.values.includes(y));

            validYValues.forEach((y: string) => {
              resultPairs.push({ x, y });
              if (resultVariable) {
                resultVariable.values.push(`(${x}, ${y})`);
              }
            });
          }
        } catch (error) {
          console.error(`API call failed for ${x}:`, error);
        }
      }
    }
  }

  const variableResults = Object.fromEntries(
    variables.map((v) => [v.name, v.values])
  );

  return Response.json({
    variables: variableResults,
    pairs: resultPairs,
    query,
  });
}
