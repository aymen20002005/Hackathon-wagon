// Instruction-like text inside retrieved data is treated as an attack, never as a command.
const PATTERNS = [
  ["instruction_override", /ignore (all |any )?(previous|prior|above|earlier) (instructions|rules|prompts?)|disregard .{0,40}(instructions|rules)|forget (everything|all) (above|before|previous)/i],
  ["role_hijack", /(^|\s)\[?(system|assistant|developer)\]?\s*(prompt|message|instructions?)?\s*:|you are now\b|new instructions?:|act as (an? )?(admin|system)/i],
  ["verification_forgery", /mark (this|the) (record|company|entry|profile) as (verified|approved|trusted)|(set|force) (the )?(confidence|trust|status)\b|skip (the )?(validation|verification|checks?)/i],
  ["exfiltration", /(send|email|post|upload|export|forward) .{0,60}\b(to|at) (https?:\/\/|\S+@\S+)|reveal .{0,30}(system prompt|api key|secret)/i],
  ["tool_abuse", /\b(call|invoke|run|execute) (the )?(tool|function|command|shell)\b/i],
];

export function screenText(text) {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([code]) => code);
}
