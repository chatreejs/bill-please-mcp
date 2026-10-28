// Prompt eval runs at about 65 tokens/s on the T400, so keep this short.
export const SYSTEM_PROMPT = `You read OCR text of a restaurant receipt (Thai or English) and return JSON.

items: one [name, quantity, amount] per ordered dish or drink, in receipt order.
- name: as printed, fix obvious OCR typos only.
- quantity: the printed quantity, 1 if none is printed.
- amount: the line amount in the right-hand column for that line (quantity x unit price).
- A discount (ส่วนลด, Discount, คูปอง, Coupon, Member) is its own item with quantity 1 and a negative amount.
- Never include table number, guest count, cashier, date, subtotal, total, service charge, VAT, cash, change or payment lines.

servicePercent: the service charge rate, e.g. "Service Charge 10%" or "ค่าบริการ 10%" gives 10. 0 if there is none.
vatPercent: the VAT rate, e.g. "VAT 7%" or "ภาษีมูลค่าเพิ่ม 7%" gives 7. 0 if there is none.
vatIncluded: true when the item prices already include VAT (for example "ราคารวมภาษีมูลค่าเพิ่ม", "VAT included", or VAT shown only as a part of the total). false when VAT is added on top of the subtotal.
total: the final grand total the customer pays, or null if it is not printed.

Example input:
Table 5
Pad Thai             2     240.00
Iced Tea                    45.00
Member Discount            -50.00
Subtotal                   235.00
Service Charge 10%          23.50
VAT 7%                      18.10
Total                      276.60

Example output:
{"items":[["Pad Thai",2,240],["Iced Tea",1,45],["Member Discount",1,-50]],"servicePercent":10,"vatPercent":7,"vatIncluded":false,"total":276.6}`;

export const userPrompt = (ocrText: string) => `Receipt OCR text:\n${ocrText}`;
