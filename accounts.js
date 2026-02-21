const fs = require('fs');
const path = require('path');
const dbFile = path.join(__dirname, 'users.json');

// Initialize DB if it doesn't exist
if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({}));
}

module.exports = {
    signup: (u, p) => {
        if (!u || !p) return { error: "Missing fields" };
        const users = JSON.parse(fs.readFileSync(dbFile));
        if (users[u]) return { error: "User already exists" };
        
        users[u] = { password: p, projects: [] };
        fs.writeFileSync(dbFile, JSON.stringify(users));
        return { success: "Account created! Please login." };
    },
    
    login: (u, p) => {
        const users = JSON.parse(fs.readFileSync(dbFile));
        if (users[u] && users[u].password === p) {
            return { success: true };
        }
        return { error: "Invalid username or password" };
    },
    
    addProject: (u, fileName) => {
        const users = JSON.parse(fs.readFileSync(dbFile));
        if (users[u]) {
            users[u].projects.push(fileName);
            fs.writeFileSync(dbFile, JSON.stringify(users));
        }
    },
    
    getProjects: (u) => {
        const users = JSON.parse(fs.readFileSync(dbFile));
        return users[u] ? users[u].projects : [];
    }
};