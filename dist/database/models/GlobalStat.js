"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalStat = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const globalStatSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 5000 },
    isFakeCounterActive: { type: Boolean, default: false }
});
exports.GlobalStat = mongoose_1.default.models.GlobalStat || mongoose_1.default.model('GlobalStat', globalStatSchema);
//# sourceMappingURL=GlobalStat.js.map