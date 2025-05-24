// Загрузка данных из JSON-файла
fetch('https://ваш_логин.github.io/репозиторий/reports.json')
    .then(response => response.json())
    .then(data => console.log(data));
