require("dotenv").config(); // <-- must be at the top
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const jwt = require("jsonwebtoken");

const token = jwt.sign({ username: "testuser" }, "myVerySecretKey123", { expiresIn: "1h" });
console.log(token);


const JWT_SECRET = process.env.JWT_SECRET;
// const PORT = 3000;
const PORT = process.env.PORT;
function verifyToken(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}


const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_FILE = path.join(__dirname, "data.json");

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

// CORS headers
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}




// Read/write image metadata
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

// Simple multipart parser for 1 file
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

        // Extract file data slice properly
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

  // Handle OPTIONS for CORS
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === "/login" && req.method === "POST") {
    setCORS(res);

    let body = [];
    req.on("data", chunk => body.push(chunk));
    req.on("end", () => {
      const { email, password } = JSON.parse(Buffer.concat(body).toString());

      // Dummy login check
      if (email === "admin@example.com" && password === "123456") {
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1h" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid credentials" }));
      }
    });
    return;
  }


  // Upload image
  if (pathname === "/upload" && req.method === "POST") {
    setCORS(res);

    const user = verifyToken(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Unauthorized" }));
      return;
    }

    parseMultipart(req, (fields, file) => {
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "No file uploaded" }));
        return;
      }
      const { filename, fileData } = file
      const safeName = filename.replace(/\s/g, "_"); // replace spaces
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
          });;
          writeData(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Uploaded!", path: "/uploads/" + saveName }));
        }
      });
    });
    return;
  }

  // if (pathname === "/upload" && req.method === "POST") {
  //   setCORS(res);
  //   parseMultipart(req, (fields, file) => {
  //     if (!file) {
  //       res.writeHead(400, { "Content-Type": "application/json" });
  //       res.end(JSON.stringify({ message: "No file uploaded" }));
  //       return;
  //     }
  //     const { filename, fileData } = file
  //     const safeName = filename.replace(/\s/g, "_"); // replace spaces
  //     const saveName = Date.now() + "-" + safeName;
  //     const savePath = path.join(UPLOAD_DIR, saveName);
  //     fs.writeFile(savePath, fileData, err => {
  //       if (err) {
  //         res.writeHead(500);
  //         res.end("Upload Error");
  //       } else {
  //         const data = readData();
  //         data.push({
  //           name: fields.name || "",
  //           email: fields.email || "",
  //           profession: fields.profession || "",
  //           originalFileName: filename,
  //           path: "/uploads/" + saveName,
  //           uploadedAt: new Date().toISOString(),
  //         });;
  //         writeData(data);
  //         res.writeHead(200, { "Content-Type": "application/json" });
  //         res.end(JSON.stringify({ message: "Uploaded!", path: "/uploads/" + saveName }));
  //       }
  //     });
  //   });
  //   return;
  // }
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

        // Remove the file from uploads folder
        const filePath = path.join(__dirname, data[idx].path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        // Remove from metadata
        data.splice(idx, 1);
        writeData(data);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Deleted successfully" }));

      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid request" }));
      }
    });
    return;
  }

  if (pathname === "/update" && req.method === "PUT") {
  setCORS(res);

  const user = verifyToken(req);
  if (!user) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Unauthorized" }));
    return;
  }

  parseMultipart(req, (fields, file) => {
    const { originalFileName, name, email, profession } = fields;

    const data = readData();
    const idx = data.findIndex(item => item.originalFileName === originalFileName);

    if (idx === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Record not found" }));
      return;
    }

    // Update metadata
    data[idx].name = name || data[idx].name;
    data[idx].email = email || data[idx].email;
    data[idx].profession = profession || data[idx].profession;
    data[idx].uploadedAt = new Date().toISOString();

    // If new file uploaded
    if (file) {
      // Delete old file
      const oldPath = path.join(__dirname, data[idx].path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

      // Save new file
      const safeName = file.filename.replace(/\s/g, "_");
      const saveName = Date.now() + "-" + safeName;
      const savePath = path.join(UPLOAD_DIR, saveName);
      fs.writeFileSync(savePath, file.fileData);

      data[idx].path = "/uploads/" + saveName;
      data[idx].originalFileName = file.filename;
    }

    writeData(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Updated successfully", updated: data[idx] }));
  });
  return;
}

  // if (pathname === "/update" && req.method === "PUT") {
  //   setCORS(res);

  //   let body = [];
  //   req.on("data", chunk => body.push(chunk));
  //   req.on("end", () => {
  //     try {
  //       body = Buffer.concat(body).toString();
  //       const updateData = JSON.parse(body);

  //       const data = readData();
  //       const idx = data.findIndex(item => {
  //         console.log(item);
  //         return item.originalFileName === updateData.originalFileName
  //       });

  //       if (idx === -1) {
  //         res.writeHead(404, { "Content-Type": "application/json" });
  //         res.end(JSON.stringify({ message: "Record not found" }));
  //         return;
  //       }

  //       data[idx].name = updateData.name || data[idx].name;
  //       data[idx].email = updateData.email || data[idx].email;
  //       data[idx].profession = updateData.profession || data[idx].profession;
  //       data[idx].uploadedAt = new Date().toISOString();
  //       // If new file uploaded
  //       if (file) {
  //         const oldPath = path.join(__dirname, data[idx].path);
  //         if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

  //         const { filename, fileData } = file;
  //         const safeName = filename.replace(/\s/g, "_");
  //         const saveName = Date.now() + "-" + safeName;
  //         const savePath = path.join(UPLOAD_DIR, saveName);

  //         fs.writeFileSync(savePath, fileData);

  //         data[idx].path = "/uploads/" + saveName;
  //       }
  //       writeData(data);

  //       res.writeHead(200, { "Content-Type": "application/json" });
  //       res.end(JSON.stringify({ message: "Updated successfully" }));
  //     } catch (err) {
  //       res.writeHead(400, { "Content-Type": "application/json" });
  //       res.end(JSON.stringify({ message: "Invalid request" }));
  //     }
  //   });
  //   return;
  // }


  // Serve uploaded images with proper streaming
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
      const stream = fs.createReadStream(imgPath);
      stream.pipe(res);
      return;
    } else {
      res.writeHead(404);
      res.end("Image Not Found");
      return;
    }
  }

  // Serve image metadata
  if (pathname === "/images" && req.method === "GET") {
    setCORS(res);
    const data = readData();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // 404 fallback
  res.writeHead(404);
  res.end("Route Not Found");
});

server.listen(PORT, () => console.log(` Backend running at http://localhost:${PORT}`));