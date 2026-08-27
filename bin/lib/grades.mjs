import { readFile } from "node:fs/promises";
import { loadGrades } from "../../js/grades.js";

export const readProjectJson = async path => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8"));
export const loadLocalGrades = season => loadGrades({ season, readJson: readProjectJson });
