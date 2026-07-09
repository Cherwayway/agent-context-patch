import { greeting } from "../src/greeting.js";

if (greeting("Ada") !== "Hello, Ada!") {
  throw new Error("greeting must preserve caller-provided names");
}

