const express = require("express")
const multer = require("multer")
const { createClient } = require("@supabase/supabase-js")
const nodemailer = require("nodemailer")
const cors = require("cors")
const path = require("path")
const fs = require("fs")

// Create Express app
const app = express()
const port = process.env.PORT || 3000

// Configure CORS to allow requests from any origin
app.use(cors())
app.use(express.json())
app.use(express.static("public"))

// Configure multer for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
})

// Configure Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "necrlresearch@gmail.com",
    pass: process.env.EMAIL_PASSWORD || "necrlresearch1!",
  },
})

// API Routes
// POST /api/submissions - Create a new submission
app.post(
  "/api/submissions",
  upload.fields([
    { name: "presentationFile", maxCount: 1 },
    { name: "paperFile", maxCount: 1 },
    { name: "logoFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("Received submission request")
      const { fullName, email, projectTitle, projectDescription, videoLink } = req.body

      // Validate required fields
      if (!fullName || !email || !projectTitle || !projectDescription || !req.files.presentationFile) {
        return res.status(400).json({ success: false, message: "Missing required fields" })
      }

      console.log("Processing files...")

      // Create file paths and save files
      const uploadDir = path.join(__dirname, "uploads")
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }

      const presentationFile = req.files.presentationFile[0]
      const presentationPath = path.join(uploadDir, `${Date.now()}-${presentationFile.originalname}`)
      fs.writeFileSync(presentationPath, presentationFile.buffer)

      let paperPath = null
      if (req.files.paperFile) {
        const paperFile = req.files.paperFile[0]
        paperPath = path.join(uploadDir, `${Date.now()}-${paperFile.originalname}`)
        fs.writeFileSync(paperPath, paperFile.buffer)
      }

      let logoPath = null
      if (req.files.logoFile) {
        const logoFile = req.files.logoFile[0]
        logoPath = path.join(uploadDir, `${Date.now()}-${logoFile.originalname}`)
        fs.writeFileSync(logoPath, logoFile.buffer)
      }

      console.log("Files saved successfully")

      // Determine status based on email domain
      const status = email.endsWith("@sfsu.edu") ? "approved" : "pending"

      // Insert submission into Supabase
      console.log("Inserting into Supabase...")
      const { data, error } = await supabase
        .from("submissions")
        .insert({
          full_name: fullName,
          email,
          project_title: projectTitle,
          project_description: projectDescription,
          video_link: videoLink || null,
          presentation_url: `/uploads/${path.basename(presentationPath)}`,
          paper_url: paperPath ? `/uploads/${path.basename(paperPath)}` : null,
          logo_url: logoPath ? `/uploads/${path.basename(logoPath)}` : null,
          status,
        })
        .select()

      if (error) {
        console.error("Error inserting submission:", error)
        return res.status(500).json({ success: false, message: "Failed to submit presentation" })
      }

      console.log("Submission saved to database")

      // If email is not from sfsu.edu, send approval email
      if (!email.endsWith("@sfsu.edu")) {
        console.log("Sending approval email...")
        // Create approval link
        const approvalLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://nercelsfsu.vercel.app"}/approve?studentId=${data[0].id}`

        // Email content
        const mailOptions = {
          from: process.env.EMAIL_USER || "necrlresearch@gmail.com",
          to: "necrlresearch@gmail.com",
          subject: `Approval Request: ${projectTitle}`,
          html: `
          <h2>New Defense Presentation Submission</h2>
          <p><strong>Student:</strong> ${fullName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Project:</strong> ${projectTitle}</p>
          <p><strong>Description:</strong> ${projectDescription}</p>
          <p>
            <a href="${approvalLink}" style="background-color: #231161; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">
              Approve Submission
            </a>
          </p>
          <p>Or copy this link: ${approvalLink}</p>
        `,
        }

        // Send email
        await transporter.sendMail(mailOptions)
        console.log("Approval email sent")
      }

      // Return success response
      return res.status(200).json({
        success: true,
        message: email.endsWith("@sfsu.edu")
          ? "Your submission has been automatically approved!"
          : "Your submission is pending approval. You'll receive an email once it's approved.",
      })
    } catch (error) {
      console.error("Error submitting presentation:", error)
      return res.status(500).json({ success: false, message: "Failed to submit presentation" })
    }
  },
)

// GET /api/submissions - Get submissions by status
app.get("/api/submissions", async (req, res) => {
  try {
    const { status } = req.query

    if (!status) {
      return res.status(400).json({ success: false, message: "Status parameter is required" })
    }

    const { data, error } = await supabase
      .from("submissions")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching submissions:", error)
      return res.status(500).json({ success: false, message: "Failed to fetch submissions" })
    }

    return res.status(200).json(data)
  } catch (error) {
    console.error("Error fetching submissions:", error)
    return res.status(500).json({ success: false, message: "Failed to fetch submissions" })
  }
})

// GET /api/calendar - Get approved submissions for calendar
app.get("/api/calendar", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("submissions")
      .select("id, full_name, project_title, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching approved submissions:", error)
      return res.status(500).json({ success: false, message: "Failed to fetch approved submissions" })
    }

    return res.status(200).json(data)
  } catch (error) {
    console.error("Error fetching approved submissions:", error)
    return res.status(500).json({ success: false, message: "Failed to fetch approved submissions" })
  }
})

// POST /api/approve - Approve a submission
app.post("/api/approve", async (req, res) => {
  try {
    const { studentId } = req.body

    if (!studentId) {
      return res.status(400).json({ success: false, message: "Student ID is required" })
    }

    const { error } = await supabase.from("submissions").update({ status: "approved" }).eq("id", studentId)

    if (error) {
      console.error("Error approving submission:", error)
      return res.status(500).json({ success: false, message: "Failed to approve submission" })
    }

    return res.status(200).json({ success: true, message: "Submission approved successfully" })
  } catch (error) {
    console.error("Error approving submission:", error)
    return res.status(500).json({ success: false, message: "Failed to approve submission" })
  }
})

// Simple approval page
app.get("/approve", (req, res) => {
  const studentId = req.query.studentId

  if (!studentId) {
    return res.redirect("/?error=missing-id")
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Approve Submission</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          border: 2px solid #231161;
          border-radius: 10px;
          padding: 20px;
          margin-top: 40px;
        }
        h1 {
          color: #231161;
        }
        .button {
          background-color: #231161;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
          margin-top: 20px;
        }
        .button:hover {
          background-color: #463077;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Approve Submission</h1>
        <p>You are about to approve a defense presentation submission. Once approved, it will be visible on the main page.</p>
        <button class="button" id="approveBtn">Confirm Approval</button>
      </div>
      
      <script>
        document.getElementById('approveBtn').addEventListener('click', async () => {
          try {
            const response = await fetch('/api/approve', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ studentId: '${studentId}' })
            });
            
            const result = await response.json();
            
            if (result.success) {
              window.location.href = '/?approved=true';
            } else {
              window.location.href = '/?error=true';
            }
          } catch (error) {
            console.error('Error:', error);
            window.location.href = '/?error=true';
          }
        });
      </script>
    </body>
    </html>
  `)
})

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})

module.exports = app
