/**
 * Enhanced transaction error handling utilities
 * Provides detailed error context for signing and transaction failures
 */

export interface TransactionError extends Error {
  code: string;
  context: string;
  originalError?: any;
  suggestions?: string[];
}

export class SigningError extends Error implements TransactionError {
  public code: string;
  public context: string;
  public originalError?: any;
  public suggestions?: string[];

  constructor(
    message: string,
    code: string,
    context: string,
    originalError?: any,
    suggestions?: string[]
  ) {
    super(message);
    this.name = "SigningError";
    this.code = code;
    this.context = context;
    this.originalError = originalError;
    this.suggestions = suggestions;
  }
}

/**
 * Creates a detailed signing error with context and suggestions
 */
export function createSigningError(
  operation: string,
  originalError: any,
  additionalContext?: string
): SigningError {
  const errorMessage = originalError?.message || "Unknown signing error";
  
  // Common signing error patterns
  if (errorMessage.includes("Invalid signature")) {
    return new SigningError(
      `Signing failed: Invalid signature during ${operation}`,
      "INVALID_SIGNATURE",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      originalError,
      [
        "Check that the private key format is correct (hex string)",
        "Verify that the public key matches the private key",
        "Ensure the account has proper authorization",
      ]
    );
  }

  if (errorMessage.includes("Private key") || errorMessage.includes("secret")) {
    return new SigningError(
      `Signing failed: Private key error during ${operation}`,
      "PRIVATE_KEY_ERROR",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      originalError,
      [
        "Verify the wallet is properly unlocked",
        "Check that the password is correct",
        "Ensure the private key is properly formatted",
      ]
    );
  }

  if (errorMessage.includes("capability") || errorMessage.includes("CAPABILITY")) {
    return new SigningError(
      `Signing failed: Missing or invalid capability during ${operation}`,
      "CAPABILITY_ERROR",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      originalError,
      [
        "Check that all required capabilities are included",
        "Verify capability parameters are correct",
        "Ensure the signer has the necessary permissions",
      ]
    );
  }

  if (errorMessage.includes("Gas") || errorMessage.includes("gas")) {
    return new SigningError(
      `Signing failed: Gas-related error during ${operation}`,
      "GAS_ERROR",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      originalError,
      [
        "Check gas limit is sufficient",
        "Verify gas payer has enough KDA",
        "Try increasing the gas limit",
      ]
    );
  }

  // Generic signing error
  return new SigningError(
    `Signing failed during ${operation}: ${errorMessage}`,
    "GENERIC_SIGNING_ERROR",
    `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
    originalError,
    [
      "Check the transaction parameters",
      "Verify all signers are properly configured",
      "Review the error logs for more details",
    ]
  );
}

/**
 * Creates a detailed simulation error with context and suggestions
 */
export function createSimulationError(
  operation: string,
  simulationResult: any,
  additionalContext?: string
): SigningError {
  const errorMessage = simulationResult?.error?.message || "Unknown simulation error";
  
  // Common simulation error patterns
  if (errorMessage.includes("Gas limit") && errorMessage.includes("exceeded")) {
    const gasMatch = errorMessage.match(/exceeded:\s*(\d+)/);
    const requiredGas = gasMatch ? gasMatch[1] : "unknown";
    
    return new SigningError(
      `Simulation failed: Gas limit exceeded during ${operation}`,
      "GAS_LIMIT_EXCEEDED",
      `Operation: ${operation} | Required gas: ${requiredGas}${additionalContext ? ` | ${additionalContext}` : ""}`,
      simulationResult,
      [
        `Try increasing gas limit to at least ${requiredGas}`,
        "Consider optimizing the transaction",
        "Check if the operation is too complex",
      ]
    );
  }

  if (errorMessage.includes("row not found") || errorMessage.includes("account does not exist")) {
    return new SigningError(
      `Simulation failed: Account not found during ${operation}`,
      "ACCOUNT_NOT_FOUND",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      simulationResult,
      [
        "Verify the account address is correct",
        "Check if the account needs to be created first",
        "Ensure the account is active on the network",
      ]
    );
  }

  if (errorMessage.includes("insufficient funds") || errorMessage.includes("balance")) {
    return new SigningError(
      `Simulation failed: Insufficient funds during ${operation}`,
      "INSUFFICIENT_FUNDS",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      simulationResult,
      [
        "Check the account balance",
        "Verify you have enough tokens for the operation",
        "Consider reducing the transaction amount",
      ]
    );
  }

  if (errorMessage.includes("keyset") || errorMessage.includes("guard")) {
    return new SigningError(
      `Simulation failed: Keyset/guard error during ${operation}`,
      "KEYSET_ERROR",
      `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
      simulationResult,
      [
        "Check that the keyset data is properly formatted",
        "Verify the guard keys match the signers",
        "Ensure the predicate is correct (keys-all, keys-any, etc.)",
      ]
    );
  }

  // Generic simulation error
  return new SigningError(
    `Simulation failed during ${operation}: ${errorMessage}`,
    "SIMULATION_FAILED",
    `Operation: ${operation}${additionalContext ? ` | ${additionalContext}` : ""}`,
    simulationResult,
    [
      "Review the PACT code for syntax errors",
      "Check that all parameters are correct",
      "Verify the smart contract is available",
    ]
  );
}

/**
 * Formats error for user display
 */
export function formatErrorForUser(error: SigningError): string {
  let message = `❌ ${error.message}\n\n`;
  
  if (error.context) {
    message += `📝 Context: ${error.context}\n\n`;
  }
  
  if (error.suggestions && error.suggestions.length > 0) {
    message += "💡 Suggestions:\n";
    error.suggestions.forEach((suggestion, index) => {
      message += `${index + 1}. ${suggestion}\n`;
    });
  }
  
  return message.trim();
}

/**
 * Logs detailed error information for debugging
 */
export function logDetailedError(error: SigningError): void {
  console.group(`🚨 ${error.name}: ${error.code}`);
  console.error("Message:", error.message);
  console.error("Context:", error.context);
  if (error.originalError) {
    console.error("Original Error:", error.originalError);
  }
  if (error.suggestions) {
    console.info("Suggestions:", error.suggestions);
  }
  console.groupEnd();
}
