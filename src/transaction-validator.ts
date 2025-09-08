import { Transaction, TransactionInput } from './types';
import { UTXOPoolManager } from './utxo-pool';
import { verify } from './utils/crypto';
import {
  ValidationResult,
  ValidationError,
  VALIDATION_ERRORS,
  createValidationError
} from './errors';

export class TransactionValidator {
  constructor(private utxoPool: UTXOPoolManager) {}

  /**
   * Validate a transaction
   * @param {Transaction} transaction - The transaction to validate
   * @returns {ValidationResult} The validation result
   */
  validateTransaction(transaction: Transaction): ValidationResult {
    const errors: ValidationError[] = [];

    if (!transaction.inputs || transaction.inputs.length === 0) {
      errors.push(
        createValidationError(
          VALIDATION_ERRORS.EMPTY_INPUTS,
          "La transaccion no tiene entrada"
        )
      );
    }

    if (!transaction.outputs || transaction.outputs.length === 0) {
      errors.push(
        createValidationError(
          VALIDATION_ERRORS.EMPTY_OUTPUTS,
          "La transaccion no tiene salida"
        )
      );
    }

    for (const output of transaction.outputs) {
      if (output.amount < 0) {
        errors.push(
          createValidationError(
            VALIDATION_ERRORS.NEGATIVE_AMOUNT,
            "La salida de la transaccion es negativa"
          )
        );
      }
      if (output.amount === 0) {
        errors.push(
          createValidationError(
            VALIDATION_ERRORS.NEGATIVE_AMOUNT,
            "La salida de la transaccion es cero"
          )
        );
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    const seen = new Set<string>();
    let inputTotal = 0;

    for (const input of transaction.inputs) {
      const key = `${input.utxoId.txId}:${input.utxoId.outputIndex}`;

      if (seen.has(key)) {
        errors.push(
          createValidationError(
            VALIDATION_ERRORS.DOUBLE_SPENDING,
            `UTXO ${key} esta referenciado más de una vez`
          )
        );
        continue;
      }
      seen.add(key);

      const utxo = this.utxoPool.getUTXO(input.utxoId.txId, input.utxoId.outputIndex);

      if (!utxo) {
        errors.push(
          createValidationError(
            VALIDATION_ERRORS.UTXO_NOT_FOUND,
            `UTXO no encontrado para ${input.utxoId.txId}:${input.utxoId.outputIndex}`
          )
        );
      } else {
        inputTotal += utxo.amount;
      }
    }

    const outputTotal = transaction.outputs.reduce((sum, o) => sum + o.amount, 0);
    if (inputTotal !== outputTotal) {
      errors.push(
        createValidationError(
          VALIDATION_ERRORS.AMOUNT_MISMATCH,
          `Input total ${inputTotal} no es igua al output total ${outputTotal}`
        )
      );
    }

    const transactionData = this.createTransactionDataForSigning_(transaction);

    for (const input of transaction.inputs) {
      const utxo = this.utxoPool.getUTXO(input.utxoId.txId, input.utxoId.outputIndex);

      if (utxo) {
        const isValid = verify(transactionData, input.signature, utxo.recipient);

        if (!isValid) {
          errors.push(
            createValidationError(
              VALIDATION_ERRORS.INVALID_SIGNATURE,
              `Firma invalida para utxo ${input.utxoId.txId}:${input.utxoId.outputIndex}`
            )
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create a deterministic string representation of the transaction for signing
   * This excludes the signatures to prevent circular dependencies
   * @param {Transaction} transaction - The transaction to create a data for signing
   * @returns {string} The string representation of the transaction for signing
   */
  private createTransactionDataForSigning_(transaction: Transaction): string {
    const unsignedTx = {
      id: transaction.id,
      inputs: transaction.inputs.map(input => ({
        utxoId: input.utxoId,
        owner: input.owner
      })),
      outputs: transaction.outputs,
      timestamp: transaction.timestamp
    };

    return JSON.stringify(unsignedTx);
  }
}
