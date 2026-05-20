"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPdfCost = getPdfCost;
function getPdfCost(pages) {
    if (pages <= 3)
        return 2;
    if (pages <= 5)
        return 3;
    if (pages <= 10)
        return 4;
    if (pages <= 20)
        return 7;
    return 10;
}
//# sourceMappingURL=pricing.js.map