import { apiPostRaw } from "/shared/js/api.js";

function wireDrop(dropEl, fileInput, browseBtn, resultEl, endpoint) {
  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropEl.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropEl.classList.remove("drag-over");
    })
  );
  dropEl.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  function setResult(text, state) {
    resultEl.textContent = text;
    resultEl.dataset.state = state;
  }

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setResult("Please choose an .xlsx file.", "error");
      return;
    }
    setResult(`Uploading ${file.name}…`, "busy");
    try {
      if (!globalThis.XLSX) throw new Error("Excel support is unavailable. Refresh the page and try again.");
      const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
      const text = globalThis.XLSX.utils.sheet_to_csv(firstSheet);
      const data = await apiPostRaw(endpoint, text, "admin");
      const { ok, failed } = data.result;
      setResult(
        `${file.name}: imported ${ok} row${ok === 1 ? "" : "s"}` + (failed ? `, ${failed} failed — check those rows' required columns` : ""),
        failed ? (ok ? "warn" : "error") : "ok"
      );
    } catch (e) {
      setResult(e.message || "Import failed", "error");
    }
  }
}

export function initExcelImport({ studentDrop, studentFile, studentBrowseBtn, studentResult, subjectDrop, subjectFile, subjectBrowseBtn, subjectResult, gradesDrop, gradesFile, gradesBrowseBtn, gradesResult }, onDone) {
  wireDrop(studentDrop, studentFile, studentBrowseBtn, studentResult, "/api/import/students");
  wireDrop(subjectDrop, subjectFile, subjectBrowseBtn, subjectResult, "/api/import/subjects");
  wireDrop(gradesDrop, gradesFile, gradesBrowseBtn, gradesResult, "/api/import/grades");
  studentFile.addEventListener("change", () => setTimeout(onDone, 800));
  subjectFile.addEventListener("change", () => setTimeout(onDone, 800));
  gradesFile.addEventListener("change", () => setTimeout(onDone, 800));
  studentDrop.addEventListener("drop", () => setTimeout(onDone, 800));
  subjectDrop.addEventListener("drop", () => setTimeout(onDone, 800));
  gradesDrop.addEventListener("drop", () => setTimeout(onDone, 800));
}
