import express from "express";
import cors from "cors";
import Joi from "joi";
import dayjs from "dayjs";
import { MongoClient } from "mongodb";
// Connection URI
const uri =
	"mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";

// Create a new MongoClient
const client = new MongoClient(uri);

async function addMessage(from, to, text, type, time) {
	try {
		await client.connect();
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const messages = db.collection("messages");
		const message = { from, to, text, type, time };
		await messages.insertOne(message);
	} finally {
		await client.close();
	}
}

async function checkConflict(name) {
	let result;
	try {
		await client.connect();
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		result = await participants.findOne({ name });
	} finally {
		await client.close();
		return result;
	}
}

async function addParticipant(name) {
	try {
		await client.connect();
		await client.db("admin").command({ ping: 1 });
		const db = client.db("chat");
		const participants = db.collection("participants");
		const participant = { name: name, lastStatus: Date.now() };
		await participants.insertOne(participant);
	} finally {
		await client.close();
	}
}

const participantSchema = Joi.object({
	name: Joi.string().min(1).required(),
});

const PORT = 5000;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
	const date = dayjs().format("DD/MM/YYYY HH:mm:ss");
	res.send("Hello World =>" + date);
});

app.post("/participants", async (req, res) => {
	const participant = req.body;

	const { error } = participantSchema.validate(participant);
	if (error) {
		res.sendStatus(422);
		return;
	}
	const conflict = await checkConflict(participant.name);
	if (conflict) {
		res.sendStatus(409);
	} else {
		const time = dayjs().format("HH:mm:ss");
		await addParticipant(participant.name);
		await addMessage(
			participant.name,
			"todos",
			"entra na sala...",
			"status",
			time
		);
		res.sendStatus(201);
	}
});

app.listen(PORT, () => {
	console.log(`Server started on port ${PORT}`);
    
});
