import { evaluateQuery } from "./evaluateQuery";

// Define token types
export const TokenType = {
  VARIABLE: "VARIABLE",
  RELATION: "RELATION",
  ENTITY: "ENTITY",
  AND: "AND",
  OR: "OR",
  WEIGHT_PARAM: "WEIGHT_PARAM",
  EOF: "EOF",
  GREP: "GREP",
} as const;

export type TokenTypeValue = (typeof TokenType)[keyof typeof TokenType];

// Define token interface
export interface Token {
  type: TokenTypeValue;
  value: string;
  position: number;
}

// AST node types
export type ASTNode = SimpleQuery | CompoundQuery;

export interface SimpleQuery {
  type: "SimpleQuery";
  subject: Token;
  relation: Token;
  object: Token;
  weightParam?: Token;
  grep?: Token;
  negated?: boolean;
}

export interface CompoundQuery {
  type: "CompoundQuery";
  left: ASTNode;
  operator: "AND" | "OR";
  right: ASTNode;
}

export type QueryResult = string[] | string[][];
export type VariableContents = { name: string; value: string[] }[];

// Create tokens
const createToken = (type: TokenTypeValue, value: string, position: number): Token => ({
  type,
  value,
  position,
});

// Create AST nodes
const createSimpleQuery = (
  subject: Token,
  relation: Token,
  object: Token,
  weightParam?: Token,
  grep?: Token,
  negated: boolean = false
): SimpleQuery => ({
  type: "SimpleQuery",
  subject,
  relation,
  object,
  weightParam,
  grep,
  negated,
});

const createCompoundQuery = (left: ASTNode, operator: "AND" | "OR", right: ASTNode): CompoundQuery => ({
  type: "CompoundQuery",
  left,
  operator,
  right,
});

// Lexer function
const createLexer = (input: string) => {
  let position = 0;
  let currentChar = input.length > 0 ? input[0] : null;

  const advance = () => {
    position++;
    if (position < input.length) {
      currentChar = input[position];
    } else {
      currentChar = null;
    }
  };

  const skipWhitespace = () => {
    while (currentChar && /\s/.test(currentChar)) {
      advance();
    }
  };

  const readIdentifier = () => {
    let result = "";
    while (currentChar && /[a-zA-Z0-9_$<>.=*?+^|[\](){}/\-!:;,@#%&"'~`éèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]/.test(currentChar)) {
      result += currentChar;
      advance();
    }
    return result;
  };

  const getNextToken = (): Token => {
    while (currentChar !== null) {
      // Skip whitespace
      if (/\s/.test(currentChar)) {
        skipWhitespace();
        continue;
      }

      // Handle variable ($x, $y)
      if (currentChar === "$") {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.VARIABLE, identifier, startPos);
      }

      // Handle relation (r_isa, r_can_eat)
      if (currentChar === "r" && position + 1 < input.length && input[position + 1] === "_") {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.RELATION, identifier, startPos);
      }

      // Handle relation (!r_isa, !r_can_eat)
      if (currentChar === "!" && position + 2 < input.length && input[position + 1] === "r" && input[position + 2] === "_") {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.RELATION, identifier, startPos);
      }

      // Handle weight parameters < and >
      if (currentChar === "<" || currentChar === ">" || currentChar === "=") {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.WEIGHT_PARAM, identifier, startPos);
      }

      // Handle Grep parameter
      if (currentChar === "/") {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.GREP, identifier, startPos);
      }

      // Handle logical operators
      if (currentChar === "A" && input.slice(position, position + 3) === "AND") {
        const startPos = position;
        position += 3;
        currentChar = position < input.length ? input[position] : null;
        return createToken(TokenType.AND, "AND", startPos);
      }

      if (currentChar === "O" && input.slice(position, position + 2) === "OR") {
        const startPos = position;
        position += 2;
        currentChar = position < input.length ? input[position] : null;
        return createToken(TokenType.OR, "OR", startPos);
      }

      // Handle entities (names like animal, lion)
      if (/[a-zA-Z]/.test(currentChar)) {
        const startPos = position;
        const identifier = readIdentifier();
        return createToken(TokenType.ENTITY, identifier, startPos);
      }

      // If we get here, character is not recognized
      throw new Error(`Unexpected character: ${currentChar}`);
    }

    // End of input
    return createToken(TokenType.EOF, "", position);
  };

  return { getNextToken };
};

// Parser function
const createParser = (lexer: ReturnType<typeof createLexer>) => {
  let currentToken = lexer.getNextToken();

  const eat = (tokenType: TokenTypeValue) => {
    if (currentToken.type === tokenType) {
      currentToken = lexer.getNextToken();
    } else {
      throw new Error(`Unexpected token: ${currentToken.value}. Expected type: ${tokenType}`);
    }
  };

  // Parses a simple triple pattern
  const simpleQuery = (): SimpleQuery => {
    let subject: Token;
    let relation: Token;
    let object: Token;
    let weightParam: Token | undefined;
    let grep: Token | undefined;
    let negated: boolean = false;

    // Parse the subject (variable or entity)
    if (currentToken.type === TokenType.VARIABLE) {
      subject = currentToken;
      eat(TokenType.VARIABLE);
    } else if (currentToken.type === TokenType.ENTITY) {
      subject = currentToken;
      eat(TokenType.ENTITY);
    } else {
      throw new Error("Expected variable or entity as subject");
    }

    // Parse the relation
    if ((currentToken.type as TokenTypeValue) === TokenType.RELATION) {
      relation = currentToken;
      negated = currentToken.value.startsWith("!");
      eat(TokenType.RELATION);
    } else {
      throw new Error("Expected relation");
    }

    // Parse the object (variable or entity)
    if (currentToken.type === TokenType.VARIABLE) {
      object = currentToken;
      eat(TokenType.VARIABLE);
    } else if (currentToken.type === TokenType.ENTITY) {
      object = currentToken;
      eat(TokenType.ENTITY);
    } else {
      throw new Error("Expected variable or entity as object");
    }

    // Parse the WeightParam
    if ((currentToken.type as TokenTypeValue) === TokenType.WEIGHT_PARAM) {
      weightParam = currentToken;
      eat(TokenType.WEIGHT_PARAM);
    }
    // Parse the GREP param
    if ((currentToken.type as TokenTypeValue) === TokenType.GREP) {
      grep = currentToken;
      eat(TokenType.GREP);
    }

    return createSimpleQuery(subject, relation, object, weightParam, grep, negated);
  };

  // Parses expressions with AND/OR operators
  const expression = (): ASTNode => {
    let node: SimpleQuery | CompoundQuery = simpleQuery();

    while (currentToken.type === TokenType.AND || currentToken.type === TokenType.OR) {
      const tokenType = currentToken.type;
      if (tokenType === TokenType.AND) {
        eat(TokenType.AND);
        node = createCompoundQuery(node, "AND", simpleQuery());
      } else if (tokenType === TokenType.OR) {
        eat(TokenType.OR);
        node = createCompoundQuery(node, "OR", simpleQuery());
      }
    }

    return node;
  };

  const parse = (): ASTNode => {
    const result = expression();

    // Make sure we've processed all the input
    if (currentToken.type !== TokenType.EOF) {
      throw new Error("Unexpected token after parsing expression");
    }

    return result;
  };

  return { parse };
};

// Convert AST to string (for debugging)
const astToString = (node: ASTNode): string => {
  if (node.type === "SimpleQuery") {
    return `${node.subject.value} ${node.relation.value} ${node.object.value}`;
  } else {
    return `(${astToString(node.left)} ${node.operator} ${astToString(node.right)})`;
  }
};

// Query engine
export const createQueryEngine = () => {
  const parseQuery = (queryString: string): ASTNode => {
    const lexer = createLexer(queryString);
    const parser = createParser(lexer);
    return parser.parse();
  };

  const executeQuery = (query: ASTNode): Promise<{ result: QueryResult; variables: VariableContents }> => {
    return evaluateQuery(query);
  };

  return {
    parseQuery,
    executeQuery,
    astToString,
  };
};
