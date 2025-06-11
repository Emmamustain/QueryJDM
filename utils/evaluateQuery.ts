import { ASTNode, QueryResult, SimpleQuery, TokenType, VariableContents } from "@/utils/parseQuery";
import relationsData from "@/lib/relations_dict.json";

// Cache global pour les appels API (à partager avec route.ts si possible)
const apiCache = new Map<string, { result: { nodes: any[]; relations: any[] }; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes de validité pour le cache

// Fonction pour vérifier si un élément est dans le cache
const getFromCache = (apiUrl: string) => {
  const cached = apiCache.get(apiUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  apiCache.delete(apiUrl);
  return null;
};

const LIMIT = 900;
const MIN_WEIGHT = 30;
const MAX_WEIGHT = 999999;

// Types pour les données de l'API
type Node = { id: number; name: string; type: number; w: number };
type Relation = { id: number; node1: number; node2: number; type: number; w: number };

// Handle API Call
const handleAPICall = async (apiUrl: string, regex?: RegExp): Promise<{ nodes: Node[]; relations: Relation[] }> => {
  const cached = getFromCache(apiUrl);
  if (cached) {
    return cached;
  }

  try {
    console.error(apiUrl);
    const res = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    const result = {
      nodes: data.nodes ?? [],
      relations: data.relations ?? [],
    };
    apiCache.set(apiUrl, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error("API call failed:", error);
    return { nodes: [], relations: [] };
  }
};

// Helper function to get related values using relations
const getRelatedEntities = async (
  val: string,
  relationId: number,
  minWeight: string | number,
  maxWeight: string | number,
  regex?: RegExp
): Promise<string[]> => {
  const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${val}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
  const data = await handleAPICall(apiUrl, regex);

  // Créer un dictionnaire pour mapper les IDs des nœuds à leurs noms
  const nodeMap = new Map<number, string>(data.nodes.map((node: Node) => [node.id, node.name]));

  // Extraire les entités cibles (node2) des relations
  let relatedEntities = data.relations
    .filter((rel: Relation) => rel.type === relationId)
    .map((rel: Relation) => nodeMap.get(rel.node2))
    .filter((name: string | undefined): name is string => name !== undefined);

  // Appliquer le filtre regex si nécessaire
  if (regex) {
    relatedEntities = relatedEntities.filter((entity: string) => regex.test(entity));
  }

  return relatedEntities;
};

// Process variable-to-variable relation ($x r_relation $y)
const processVariableToVariableRelation = async (
  leftVarName: string,
  leftVarValues: string[],
  rightVarName: string,
  rightVarValues: string[],
  relationId: number,
  minWeight: string | number,
  maxWeight: string | number,
  regex?: RegExp
): Promise<VariableContents> => {
  const resultVarName = `${leftVarName}_${rightVarName}_pairs`;
  const validPairs: string[] = [];

  // Convertir rightVarValues en Set pour des recherches plus rapides
  const rightVarSet = new Set(rightVarValues);

  // Préparer les appels API en parallèle
  const relatedEntitiesMap = new Map<string, string[]>();
  await Promise.all(
    leftVarValues.map(async (leftValue) => {
      const relatedEntities = await getRelatedEntities(leftValue, relationId, minWeight, maxWeight, regex);
      relatedEntitiesMap.set(leftValue, relatedEntities);
    })
  );

  // Générer les paires
  for (const leftValue of leftVarValues) {
    const relatedEntities = relatedEntitiesMap.get(leftValue) || [];
    for (const rightValue of relatedEntities) {
      if (rightVarSet.has(rightValue)) {
        validPairs.push(`${leftValue},${rightValue}`);
      }
    }
  }

  return [{ name: resultVarName, value: validPairs }];
};

// Evaluation functions
export const evaluateSimpleQuery = async (query: SimpleQuery, existingVariables: VariableContents = []): Promise<VariableContents> => {
  const variables: VariableContents = [];
  let apiUrl = "";

  const subject = query.subject.value;
  const object = query.object.value;
  const relation = query.relation.value.replace("!", "");
  let minWeight = query.weightParam?.value.includes(">=") ? query.weightParam?.value.replace(/[<>=]/, "") : MIN_WEIGHT;
  let maxWeight = query.weightParam?.value.includes("<=") ? query.weightParam?.value.replace(/[<>=]/, "") : MAX_WEIGHT;
  if (query.weightParam?.value.replaceAll(/[0-9]/g, "") === "=") {
    minWeight = maxWeight = query.weightParam?.value.replace(/[<>=]/, "");
  }
  const regex = query.grep?.value ? new RegExp(query.grep.value.replaceAll("/", "")) : undefined;

  const relationId = relationsData.relations.find((v) => v.code === relation)?.id;

  if (relationId === undefined) {
    throw new Error(`Relation "${relation}" not recognized`);
  }

  // case 1: $x r_relation word
  if (query.subject.type === TokenType.VARIABLE && query.object.type === TokenType.ENTITY) {
    if (query.negated) {
      // For negated relations, we need to get all possible values and filter out the ones that match
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/to/${object}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
      const data = await handleAPICall(apiUrl, regex);
      const matchingValues = new Set(data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name));

      // Get all possible values for the subject variable
      const allValues = existingVariables.find((v) => v.name === subject)?.value || [];
      let newValues = allValues.filter((value) => !matchingValues.has(value));

      if (regex) {
        newValues = newValues.filter((node: string) => regex.test(node));
      }

      variables.push({
        name: query.subject.value,
        value: newValues,
      });
    } else {
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/to/${object}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
      const data = await handleAPICall(apiUrl, regex);
      let newValues = data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name);
      if (regex) {
        newValues = newValues.filter((node: string) => regex.test(node));
      }
      variables.push({
        name: query.subject.value,
        value: newValues,
      });
    }
  }
  // case 2: word r_relation $x
  else if (query.subject.type === TokenType.ENTITY && query.object.type === TokenType.VARIABLE) {
    if (query.negated) {
      // For negated relations, we need to get all possible values and filter out the ones that match
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${subject}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
      const data = await handleAPICall(apiUrl, regex);
      const matchingValues = new Set(data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name));

      // Get all possible values for the object variable
      const allValues = existingVariables.find((v) => v.name === object)?.value || [];
      let newValues = allValues.filter((value) => !matchingValues.has(value));

      if (regex) {
        newValues = newValues.filter((node: string) => regex.test(node));
      }

      variables.push({
        name: query.object.value,
        value: newValues,
      });
    } else {
      apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${subject}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
      const data = await handleAPICall(apiUrl, regex);
      let newValues = data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name);
      if (regex) {
        newValues = newValues.filter((node: string) => regex.test(node));
      }
      variables.push({
        name: query.object.value,
        value: newValues,
      });
    }
  }
  // case 3: $x r_relation $y (both variables)
  else if (query.subject.type === TokenType.VARIABLE && query.object.type === TokenType.VARIABLE) {
    const leftVar = existingVariables.find((v) => v.name === subject);
    const rightVar = existingVariables.find((v) => v.name === object);

    if (query.negated) {
      // For negated relations, we need to get all possible pairs and filter out the ones that match
      const resultVarName = `${leftVar?.name || subject}_${rightVar?.name || object}_pairs`;
      const validPairs: string[] = [];

      if (leftVar && rightVar) {
        // Both variables are defined, use existing logic
        const rightVarSet = new Set(rightVar.value);

        // Get all matching pairs
        const relatedEntitiesMap = new Map<string, string[]>();
        await Promise.all(
          leftVar.value.map(async (leftValue) => {
            const relatedEntities = await getRelatedEntities(leftValue, relationId, minWeight, maxWeight, regex);
            relatedEntitiesMap.set(leftValue, relatedEntities);
          })
        );

        // Generate all possible pairs
        for (const leftValue of leftVar.value) {
          for (const rightValue of rightVar.value) {
            const relatedEntities = relatedEntitiesMap.get(leftValue) || [];
            // Only include pairs that don't match the relation
            if (!relatedEntities.includes(rightValue)) {
              validPairs.push(`${leftValue},${rightValue}`);
            }
          }
        }
      } else if (leftVar) {
        // Only left variable is defined, use from/{x} API
        const relatedEntitiesMap = new Map<string, string[]>();
        await Promise.all(
          leftVar.value.map(async (leftValue) => {
            const relatedEntities = await getRelatedEntities(leftValue, relationId, minWeight, maxWeight, regex);
            relatedEntitiesMap.set(leftValue, relatedEntities);
          })
        );

        // Get all possible right values
        const allRightValues = new Set<string>();
        for (const entities of relatedEntitiesMap.values()) {
          entities.forEach((entity) => allRightValues.add(entity));
        }

        // Generate all possible pairs
        for (const leftValue of leftVar.value) {
          for (const rightValue of allRightValues) {
            const relatedEntities = relatedEntitiesMap.get(leftValue) || [];
            // Only include pairs that don't match the relation
            if (!relatedEntities.includes(rightValue)) {
              validPairs.push(`${leftValue},${rightValue}`);
            }
          }
        }
      } else if (rightVar) {
        // Only right variable is defined, use to/{y} API
        const relatedEntitiesMap = new Map<string, string[]>();
        await Promise.all(
          rightVar.value.map(async (rightValue) => {
            const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/to/${rightValue}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
            const data = await handleAPICall(apiUrl, regex);
            const relatedEntities = data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name);
            relatedEntitiesMap.set(rightValue, relatedEntities);
          })
        );

        // Get all possible left values
        const allLeftValues = new Set<string>();
        for (const entities of relatedEntitiesMap.values()) {
          entities.forEach((entity) => allLeftValues.add(entity));
        }

        // Generate all possible pairs
        for (const leftValue of allLeftValues) {
          for (const rightValue of rightVar.value) {
            const relatedEntities = relatedEntitiesMap.get(rightValue) || [];
            // Only include pairs that don't match the relation
            if (!relatedEntities.includes(leftValue)) {
              validPairs.push(`${leftValue},${rightValue}`);
            }
          }
        }
      } else {
        // Both variables are undefined, fetch all pairs
        const nodesApiUrl = `https://jdm-api.demo.lirmm.fr/v0/nodes?type=1&limit=${LIMIT}`;
        const nodesData = await handleAPICall(nodesApiUrl);
        const nodeMap = new Map<number, string>(nodesData.nodes.map((node: Node) => [node.id, node.name]));

        // Get all valid pairs
        const processedNodes = new Set<string>();
        for (const node of nodesData.nodes) {
          const nodeName = node.name;
          if (processedNodes.has(nodeName)) continue;
          processedNodes.add(nodeName);

          // Query relations for this node
          const relationsApiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${nodeName}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
          const relationsData = await handleAPICall(relationsApiUrl, regex);

          // Process relations
          for (const rel of relationsData.relations) {
            if (rel.type === relationId) {
              const rightName = nodeMap.get(rel.node2);
              if (rightName) {
                if (!regex || (regex.test(nodeName) && regex.test(rightName))) {
                  validPairs.push(`${nodeName},${rightName}`);
                }
              }
            }
          }
        }
      }

      return [{ name: resultVarName, value: validPairs }];
    } else {
      // For non-negated relations
      if (leftVar && rightVar) {
        // Both variables are defined, use existing logic
        return await processVariableToVariableRelation(subject, leftVar.value, object, rightVar.value, relationId, minWeight, maxWeight, regex);
      } else if (leftVar) {
        // Only left variable is defined, use from/{x} API
        const relatedEntitiesMap = new Map<string, string[]>();
        await Promise.all(
          leftVar.value.map(async (leftValue) => {
            const relatedEntities = await getRelatedEntities(leftValue, relationId, minWeight, maxWeight, regex);
            relatedEntitiesMap.set(leftValue, relatedEntities);
          })
        );

        const validPairs: string[] = [];
        for (const [leftValue, rightValues] of relatedEntitiesMap.entries()) {
          for (const rightValue of rightValues) {
            validPairs.push(`${leftValue},${rightValue}`);
          }
        }

        return [{ name: `${subject}_${object}_pairs`, value: validPairs }];
      } else if (rightVar) {
        // Only right variable is defined, use to/{y} API
        const relatedEntitiesMap = new Map<string, string[]>();
        await Promise.all(
          rightVar.value.map(async (rightValue) => {
            const apiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/to/${rightValue}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
            const data = await handleAPICall(apiUrl, regex);
            const relatedEntities = data.nodes.filter((node: Node) => node.type === 1).map((node: Node) => node.name);
            relatedEntitiesMap.set(rightValue, relatedEntities);
          })
        );

        const validPairs: string[] = [];
        for (const [rightValue, leftValues] of relatedEntitiesMap.entries()) {
          for (const leftValue of leftValues) {
            validPairs.push(`${leftValue},${rightValue}`);
          }
        }

        return [{ name: `${subject}_${object}_pairs`, value: validPairs }];
      } else {
        // Both variables are undefined, fetch all pairs
        const nodesApiUrl = `https://jdm-api.demo.lirmm.fr/v0/nodes?type=1&limit=${LIMIT}`;
        const nodesData = await handleAPICall(nodesApiUrl);
        const nodeMap = new Map<number, string>(nodesData.nodes.map((node: Node) => [node.id, node.name]));

        // Get all valid pairs
        const validPairs: string[] = [];
        const processedNodes = new Set<string>();
        for (const node of nodesData.nodes) {
          const nodeName = node.name;
          if (processedNodes.has(nodeName)) continue;
          processedNodes.add(nodeName);

          // Query relations for this node
          const relationsApiUrl = `https://jdm-api.demo.lirmm.fr/v0/relations/from/${nodeName}?types_ids=${relationId}&min_weight=${minWeight}&max_weight=${maxWeight}&limit=${LIMIT}&type=1`;
          const relationsData = await handleAPICall(relationsApiUrl, regex);

          // Process relations
          for (const rel of relationsData.relations) {
            if (rel.type === relationId) {
              const rightName = nodeMap.get(rel.node2);
              if (rightName) {
                if (!regex || (regex.test(nodeName) && regex.test(rightName))) {
                  validPairs.push(`${nodeName},${rightName}`);
                }
              }
            }
          }
        }

        return [{ name: `${subject}_${object}_pairs`, value: validPairs }];
      }
    }
  }

  if (!apiUrl && apiUrl === "" && variables.length === 0) {
    throw new Error(`Invalid API URL ${apiUrl} or case not implemented`);
  }

  return variables;
};

// Update the return type to include variable labels
type LabeledTuple = Record<string, string>;

// Helper function to generate all possible tuples from variable pairs
const generateTuples = (variables: VariableContents): LabeledTuple[] => {
  const pairRelations = new Map<string, [string, string][]>(); // e.g., "x_y" → [ ["lion", "giraffe"], ... ]
  const variableValues = new Map<string, Set<string>>();

  // Build a graph of variable connections to determine the chain
  const relationGraph = new Map<string, Set<string>>();

  // First pass: collect variables and their values
  for (const v of variables) {
    if (v.name.includes("_pairs")) {
      const [var1, var2] = v.name.split("_pairs")[0].split("_");
      const key = `${var1}_${var2}`;
      const pairs = v.value.map((val) => val.split(",")) as [string, string][];
      pairRelations.set(key, pairs);

      if (!relationGraph.has(var1)) {
        relationGraph.set(var1, new Set());
      }
      relationGraph.get(var1)!.add(var2);
    } else {
      variableValues.set(v.name, new Set(v.value));
    }
  }

  const allVariables = new Set<string>();
  for (const [key, _] of pairRelations) {
    const [var1, var2] = key.split("_");
    allVariables.add(var1);
    allVariables.add(var2);
  }

  const findConnections = (currentPath: string[]): string[] => {
    if (currentPath.length === 0) return Array.from(allVariables);

    const lastVar = currentPath[currentPath.length - 1];
    const connectedVars: string[] = [];

    if (relationGraph.has(lastVar)) {
      relationGraph.get(lastVar)!.forEach((connectedVar) => {
        if (!currentPath.includes(connectedVar)) {
          connectedVars.push(connectedVar);
        }
      });
    }

    for (const [var1, connections] of relationGraph.entries()) {
      if (!currentPath.includes(var1) && connections.has(lastVar)) {
        connectedVars.push(var1);
      }
    }

    return connectedVars;
  };

  const buildChains = (currentPath: string[], allChains: string[][]): void => {
    if (currentPath.length === allVariables.size) {
      allChains.push([...currentPath]);
      return;
    }

    const connections = findConnections(currentPath);
    for (const nextVar of connections) {
      if (!currentPath.includes(nextVar)) {
        buildChains([...currentPath, nextVar], allChains);
      }
    }
  };

  const possibleChains: string[][] = [];
  buildChains([], possibleChains);

  if (possibleChains.length === 0) {
    possibleChains.push(Array.from(allVariables));
  }

  const chain = possibleChains[0];
  console.log("Using variable chain:", chain);

  const results: LabeledTuple[] = [];

  const buildTuples = (index: number, currentTuple: Map<string, string>): void => {
    if (index === chain.length) {
      const labeledTuple: LabeledTuple = {};
      currentTuple.forEach((value, key) => {
        labeledTuple[key] = value;
      });
      results.push(labeledTuple);
      return;
    }

    const currentVar = chain[index];
    let potentialValues: string[];

    if (variableValues.has(currentVar)) {
      potentialValues = Array.from(variableValues.get(currentVar)!);
    } else {
      const allPossibleValues = new Set<string>();
      for (const [key, pairs] of pairRelations) {
        const [var1, var2] = key.split("_");
        if (var1 === currentVar) {
          pairs.forEach(([val, _]) => allPossibleValues.add(val));
        } else if (var2 === currentVar) {
          pairs.forEach(([_, val]) => allPossibleValues.add(val));
        }
      }
      potentialValues = Array.from(allPossibleValues);
    }

    for (const value of potentialValues) {
      let isValid = true;

      for (let i = 0; i < index; i++) {
        const prevVar = chain[i];
        const prevValue = currentTuple.get(prevVar)!;

        const forwardKey = `${prevVar}_${currentVar}`;
        const backwardKey = `${currentVar}_${prevVar}`;

        if (pairRelations.has(forwardKey)) {
          const validPair = pairRelations.get(forwardKey)!.some(([from, to]) => from === prevValue && to === value);
          if (!validPair) {
            isValid = false;
            break;
          }
        } else if (pairRelations.has(backwardKey)) {
          const validPair = pairRelations.get(backwardKey)!.some(([from, to]) => from === value && to === prevValue);
          if (!validPair) {
            isValid = false;
            break;
          }
        }
      }

      if (isValid) {
        const newTuple = new Map(currentTuple);
        newTuple.set(currentVar, value);
        buildTuples(index + 1, newTuple);
      }
    }
  };

  buildTuples(0, new Map());
  return results;
};

// Update evaluateQuery function to handle labeled tuples
export const evaluateQuery = async (
  query: ASTNode,
  existingVariables: VariableContents = []
): Promise<{ result: QueryResult; variables: VariableContents }> => {
  if (query.type === "SimpleQuery") {
    const variables = await evaluateSimpleQuery(query, existingVariables);

    const mergedVariables = [...existingVariables];
    for (const newVar of variables) {
      const existingIndex = mergedVariables.findIndex((v) => v.name === newVar.name);
      if (existingIndex >= 0) {
        mergedVariables[existingIndex] = newVar;
      } else {
        mergedVariables.push(newVar);
      }
    }

    return { result: variables[0]?.value || [], variables: mergedVariables };
  } else {
    const leftResult = await evaluateQuery(query.left, existingVariables);
    const rightResult = await evaluateQuery(query.right, leftResult.variables);

    let combinedVariables: VariableContents = [];

    if (query.operator === "AND") {
      if (leftResult.variables.length === 0 || rightResult.variables.length === 0) {
        return { result: [], variables: [] };
      }

      for (const leftVar of leftResult.variables) {
        const rightVar = rightResult.variables.find((v) => v.name === leftVar.name);

        if (rightVar) {
          const intersection = leftVar.value.filter((value) => rightVar.value.includes(value));
          if (intersection.length > 0) {
            combinedVariables.push({
              name: leftVar.name,
              value: intersection,
            });
          }
        } else {
          combinedVariables.push(leftVar);
        }
      }

      for (const rightVar of rightResult.variables) {
        if (!leftResult.variables.some((v) => v.name === rightVar.name)) {
          combinedVariables.push(rightVar);
        }
      }

      if (combinedVariables.some((v) => v.value.length === 0)) {
        return { result: [], variables: [] };
      }
    } else if (query.operator === "OR") {
      if (leftResult.variables.length === 0) {
        return rightResult;
      }
      if (rightResult.variables.length === 0) {
        return leftResult;
      }

      combinedVariables = [...leftResult.variables];
      for (const rightVar of rightResult.variables) {
        const existingVarIndex = combinedVariables.findIndex((v) => v.name === rightVar.name);
        if (existingVarIndex >= 0) {
          combinedVariables[existingVarIndex].value = [...new Set([...combinedVariables[existingVarIndex].value, ...rightVar.value])];
        } else {
          combinedVariables.push(rightVar);
        }
      }
    }

    const tuples = generateTuples(combinedVariables);
    const result = tuples.map((tuple) => Object.values(tuple).join(","));

    // Filtrer les variables $x et $y basées sur les paires dans result
    const filteredVariables: VariableContents = combinedVariables.map((variable) => ({ ...variable }));

    // Identifier les paires dans result et les variables correspondantes
    const pairsVariables = filteredVariables.filter((v) => v.name.includes("_pairs"));
    for (const pairVar of pairsVariables) {
      const [var1, var2] = pairVar.name.split("_pairs")[0].split("_");
      const var1Values = new Set<string>();
      const var2Values = new Set<string>();

      // Extraire les valeurs de var1 et var2 à partir des paires
      for (const pair of pairVar.value) {
        const [val1, val2] = pair.split(",");
        var1Values.add(val1);
        var2Values.add(val2);
      }

      // Mettre à jour les valeurs de var1 ($x) et var2 ($y)
      const var1Index = filteredVariables.findIndex((v) => v.name === var1);
      const var2Index = filteredVariables.findIndex((v) => v.name === var2);

      if (var1Index >= 0) {
        filteredVariables[var1Index].value = [...var1Values];
      }
      if (var2Index >= 0) {
        filteredVariables[var2Index].value = [...var2Values];
      }
    }

    return { result, variables: filteredVariables };
  }
};
