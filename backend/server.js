require("dotenv").config()
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3001; // Render-friendly port
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_FILE = path.join(__dirname, "data.json");

// Ensure dirs exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Multipart parser
function parseMultipart(req, callback) {
  let body = [];
  req.on("data", chunk => body.push(chunk));
  req.on("end", () => {
    body = Buffer.concat(body);
    const boundary = "--" + req.headers["content-type"].split("boundary=")[1];
    const parts = body.toString("binary").split(boundary);
    let fields = {};
    let file = null;

    for (let part of parts) {
      if (part.includes('filename="')) {
        const match = part.match(/filename="(.+)"/);
        if (!match) continue;
        const filename = match[1];
        const start = part.indexOf("\r\n\r\n") + 4;
        const end = part.lastIndexOf("\r\n");
        const fileData = Buffer.from(part.slice(start, end), "binary");
        file = { filename, fileData };
      } else if (part.includes("Content-Disposition") && part.includes('name="')) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        const fieldName = nameMatch[1];
        const start = part.indexOf("\r\n\r\n") + 4;
        const end = part.lastIndexOf("\r\n");
        const value = part.slice(start, end).toString().trim();
        fields[fieldName] = value;
      }
    }
    callback(fields, file);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Upload route
  if (pathname === "/upload" && req.method === "POST") {
    setCORS(res);
    parseMultipart(req, (fields, file) => {
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "No file uploaded" }));
        return;
      }
      const { filename, fileData } = file;
      const safeName = filename.replace(/\s/g, "_");
      const saveName = Date.now() + "-" + safeName;
      const savePath = path.join(UPLOAD_DIR, saveName);

      fs.writeFile(savePath, fileData, err => {
        if (err) {
          res.writeHead(500);
          res.end("Upload Error");
        } else {
          const data = readData();
          data.push({
            name: fields.name || "",
            email: fields.email || "",
            profession: fields.profession || "",
            originalFileName: filename,
            path: "/uploads/" + saveName,
            uploadedAt: new Date().toISOString(),
          });
          writeData(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Uploaded!", path: "/uploads/" + saveName }));
        }
      });
    });
    return;
  }

  // Update route (supports image update)
  if (pathname === "/update" && req.method === "PUT") {
    setCORS(res);
    const contentType = req.headers["content-type"] || "";

    // If image provided (multipart)
    if (contentType.startsWith("multipart/form-data")) {
      parseMultipart(req, (fields, file) => {
        const data = readData();
        const idx = data.findIndex(item => item.originalFileName === fields.originalFileName);
        if (idx === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Record not found" }));
          return;
        }

        data[idx].name = fields.name || data[idx].name;
        data[idx].email = fields.email || data[idx].email;
        data[idx].profession = fields.profession || data[idx].profession;
        data[idx].uploadedAt = new Date().toISOString();

        if (file) {
          const { filename, fileData } = file;
          const safeName = filename.replace(/\s/g, "_");
          const newName = Date.now() + "-" + safeName;
          const newPath = path.join(UPLOAD_DIR, newName);

          const oldPath = path.join(__dirname, data[idx].path);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

          fs.writeFileSync(newPath, fileData);
          data[idx].originalFileName = filename;
          data[idx].path = "/uploads/" + newName;
        }

        writeData(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Updated successfully", updated: data[idx] }));
      });
      return;
    }

    // If only text update
    let body = [];
    req.on("data", chunk => body.push(chunk));
    req.on("end", () => {
      try {
        body = Buffer.concat(body).toString();
        const updateData = JSON.parse(body);
        const data = readData();
        const idx = data.findIndex(item => item.originalFileName === updateData.originalFileName);
        if (idx === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Record not found" }));
          return;
        }
        data[idx].name = updateData.name || data[idx].name;
        data[idx].email = updateData.email || data[idx].email;
        data[idx].profession = updateData.profession || data[idx].profession;
        data[idx].uploadedAt = new Date().toISOString();
        writeData(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Updated successfully" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid request" }));
      }
    });
    return;
  }

  // Delete route
  if (pathname === "/delete" && req.method === "DELETE") {
    setCORS(res);
    let body = [];
    req.on("data", chunk => body.push(chunk));
    req.on("end", () => {
      try {
        body = Buffer.concat(body).toString();
        const deleteData = JSON.parse(body);
        const data = readData();
        const idx = data.findIndex(item => item.originalFileName === deleteData.originalFileName);
        if (idx === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Record not found" }));
          return;
        }
        const filePath = path.join(__dirname, data[idx].path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        data.splice(idx, 1);
        writeData(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Deleted successfully" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid request" }));
      }
    });
    return;
  }

  // Serve images
  if (pathname.startsWith("/uploads/") && req.method === "GET") {
    setCORS(res);
    const imgPath = path.join(__dirname, pathname);
    if (fs.existsSync(imgPath)) {
      const ext = path.extname(imgPath).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".png") contentType = "image/png";
      else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".gif") contentType = "image/gif";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(imgPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Image Not Found");
    }
    return;
  }

  // List images
  if (pathname === "/images" && req.method === "GET") {
    setCORS(res);
    const data = readData();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  res.writeHead(404);
  res.end("Route Not Found");
});

server.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));
