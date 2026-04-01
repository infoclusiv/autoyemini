export function exportQuestionsToJSON(questions) {
  const exportPayload = {
    exportTime: new Date().toISOString(),
    totalQuestions: questions.length,
    completedQuestions: questions.filter((question) => question.status === "completed").length,
    questions: questions.map((question) => ({
      question: question.question,
      status: question.status,
      answer: question.answer,
      sources: question.sources,
      timestamp: question.timestamp,
      completedAt: question.completedAt,
      error: question.error
    }))
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = `chatgpt-answers-${Date.now()}.json`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

export function exportSingleWorkflow(snapshot) {
  const safeName = snapshot.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const exportPayload = {
    version: 1,
    exportTime: new Date().toISOString(),
    workflow: snapshot
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = `workflow-backup-${safeName}-${Date.now()}.json`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}