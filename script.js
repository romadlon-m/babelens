const API_URL =
  "https://script.google.com/macros/s/AKfycbwCCgzR89n5wLrSRkWqCCZDLAvzbWwx9Y-3Dhn5QpHf2NSXFhoKdjkJmN_wG-EZKqu6/exec";


// =====================================
// SEARCH
// =====================================
function search(page = 1) {

  const keyword =
    document
      .getElementById("keyword")
      .value;

  const params = new URLSearchParams({
    action: "searchNews",

    keyword,

    page,

    pageSize: 25,

    f_title: true,
    f_summary: true,
    f_full: false,

    pdrb_relevan: true
  });

  document.getElementById("result")
    .innerHTML = "Loading...";

  fetch(`${API_URL}?${params}`)
    .then(res => res.json())
    .then(render)
    .catch(err => {

      console.error(err);

      document.getElementById("result")
        .innerHTML =
          "Failed to load data";
    });
}


// =====================================
// RENDER
// =====================================
function render(data) {

  document.getElementById("meta")
    .innerHTML =
      `Found ${data.totalFound} articles`;

  if (!data.rows.length) {

    document.getElementById("result")
      .innerHTML =
        "No results";

    return;
  }

  let html = `
    <table>
      <tr>
        <th>Date</th>
        <th>Title</th>
        <th>Summary</th>
        <th>Source</th>
      </tr>
  `;

  data.rows.forEach(r => {

    html += `
      <tr>

        <td>
          ${r.publication_datetime}
        </td>

        <td>
          <a
            href="${r.url}"
            target="_blank"
          >
            ${r.title}
          </a>
        </td>

        <td class="summary">
          ${r.summary}
        </td>

        <td>
          ${r.source}
        </td>

      </tr>
    `;
  });

  html += "</table>";

  document.getElementById("result")
    .innerHTML = html;
}


// =====================================
// FIRST LOAD
// =====================================
window.onload = () => {
  search(1);
};
