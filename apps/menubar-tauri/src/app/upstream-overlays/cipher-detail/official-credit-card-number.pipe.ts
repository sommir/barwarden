import { Pipe, PipeTransform } from "@angular/core";

interface CardRuleEntry {
  readonly cardLength: number;
  readonly blocks: readonly number[];
}

const numberFormats: Record<string, readonly CardRuleEntry[]> = {
  Visa: [{ cardLength: 16, blocks: [4, 4, 4, 4] }],
  Mastercard: [{ cardLength: 16, blocks: [4, 4, 4, 4] }],
  Maestro: [
    { cardLength: 16, blocks: [4, 4, 4, 4] },
    { cardLength: 13, blocks: [4, 4, 5] },
    { cardLength: 15, blocks: [4, 6, 5] },
    { cardLength: 19, blocks: [4, 4, 4, 4, 3] },
  ],
  Discover: [{ cardLength: 16, blocks: [4, 4, 4, 4] }],
  "Diners Club": [{ cardLength: 14, blocks: [4, 6, 4] }],
  JCB: [{ cardLength: 16, blocks: [4, 4, 4, 4] }],
  UnionPay: [
    { cardLength: 16, blocks: [4, 4, 4, 4] },
    { cardLength: 19, blocks: [6, 13] },
  ],
  Amex: [{ cardLength: 15, blocks: [4, 6, 5] }],
  Other: [{ cardLength: 16, blocks: [4, 4, 4, 4] }],
};

@Pipe({
  name: "creditCardNumber",
  standalone: true,
})
export class OfficialCreditCardNumberPipe implements PipeTransform {
  transform(creditCardNumber: string | undefined, brand: string | undefined): string {
    const normalizedNumber = (creditCardNumber ?? "").replace(/\D/g, "");
    const rules = numberFormats[brand ?? ""] ?? numberFormats["Other"];
    const cardLength = normalizedNumber.length;
    const matchingRule = rules.find((rule) => rule.cardLength === cardLength) ?? rules[0]!;
    const chunks: string[] = [];
    let total = 0;

    for (const block of matchingRule.blocks) {
      chunks.push(normalizedNumber.slice(total, total + block));
      total += block;
    }
    if (cardLength > total) {
      chunks.push(normalizedNumber.slice(total));
    }

    return chunks.join(" ");
  }
}
